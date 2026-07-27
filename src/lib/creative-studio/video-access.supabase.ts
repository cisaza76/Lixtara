// Gate 5 pre-rollout — the concrete service-role adapter for the video-access authority:
// the AccessReader (list a user's active grants) and the QuotaConsumer (atomically consume one
// generation). Both talk ONLY to the service-role client — RLS on
// `creative_studio_video_access` is deny-all, so no browser client can read or write it.
//
// PRINCIPLES (mirrors SupabaseArchiveWriter):
// - The reader NEVER swallows errors: a DB failure throws so requireVideoFeatureAccess fails
//   closed and logs a content-free signal. Returning [] on error would silently grant "no_grant"
//   which is indistinguishable from a real empty allowlist — acceptable for denial, but we still
//   want the reader_error signal, so we throw.
// - The consume is ONE guarded conditional UPDATE (compare-and-swap): all protection lives in the
//   WHERE. No read→decide→update. `generations_used = expectedUsed` makes it a CAS so two
//   concurrent consumers can never both take the same slot; `generations_used < max_generations`
//   is the ceiling (enforced HERE, never as a table CHECK — spec v2 §0).
import type {
  AccessReader,
  QuotaConsumeResult,
  QuotaConsumer,
  VideoAccessGrant,
} from "@/lib/creative-studio/video-access";

// Minimal structural view of the service client — only the chains this adapter builds. (Mirrors
// SupabaseArchiveWriter: no hard dependency on the full @supabase/supabase-js client type, so the
// unit tests can hand it a stateful fake.)
interface SelectChain {
  eq(column: string, value: string): SelectChain;
  is(column: string, value: null): SelectChain;
  order(column: string, opts: { ascending: boolean }): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}
interface UpdateChain {
  eq(column: string, value: string | number | boolean): UpdateChain;
  is(column: string, value: null): UpdateChain;
  select(columns: string): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}
export interface VideoAccessClient {
  from(table: string): {
    select(columns: string): SelectChain;
    update(values: Record<string, unknown>): UpdateChain;
  };
}

const TABLE = "creative_studio_video_access";

// Row shape as stored (snake_case). Mapped to the camelCase VideoAccessGrant the authority reads.
interface AccessRow {
  id: string;
  user_id: string;
  listing_id: string | null;
  enabled: boolean;
  max_generations: number;
  generations_used: number;
  valid_from: string | null;
  valid_until: string | null;
  revoked_at: string | null;
}

function toGrant(r: AccessRow): VideoAccessGrant {
  return {
    id: r.id,
    userId: r.user_id,
    listingId: r.listing_id,
    enabled: r.enabled,
    maxGenerations: r.max_generations,
    generationsUsed: r.generations_used,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    revokedAt: r.revoked_at,
  };
}

export class SupabaseVideoAccessStore implements AccessReader, QuotaConsumer {
  private readonly client: VideoAccessClient;

  constructor(client: VideoAccessClient) {
    this.client = client;
  }

  // All non-revoked grants for the user (the `..._user_lookup` partial index covers this). Only
  // returns rows; scope/window/quota are decided by the pure authority. THROWS on DB error.
  async listActiveGrants(userId: string): Promise<VideoAccessGrant[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select(
        "id, user_id, listing_id, enabled, max_generations, generations_used, valid_from, valid_until, revoked_at",
      )
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("listing_id", { ascending: true });
    if (error) {
      throw new Error(`video-access read failed: ${error.message ?? error.code ?? "unknown"}`);
    }
    const rows = (data as AccessRow[] | null) ?? [];
    return rows.map(toGrant);
  }

  // THE atomic primitive: a single guarded conditional UPDATE. 1 row = consumed; 0 rows = slot
  // NOT taken (exhausted / revoked / disabled / lost CAS). No pre-read — every guard is in the
  // WHERE. Called at most once per logical job (createJob.created===true), so a lost CAS here is
  // the rare distinct-generation boundary race; the caller logs it and proceeds (safe direction).
  //
  // The ceiling (generations_used < max_generations) is NOT a separate filter — supabase-js
  // filters compare a column to a literal, not column-to-column. It is enforced by the
  // compare-and-swap instead: a consumer only reaches here after the authority read used < max
  // and passed `expectedUsed = used`; the CAS `generations_used = expectedUsed` lands the write
  // ONLY if the row is still at that value, so the new value is expectedUsed + 1 <= max. Two
  // consumers racing the last slot both hold expectedUsed = max - 1, but only the first CAS
  // matches — the second sees the moved value and gets 0 rows. The ceiling can never be exceeded.
  async consumeGeneration(input: {
    grantId: string;
    userId: string;
    expectedUsed: number;
  }): Promise<QuotaConsumeResult> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ generations_used: input.expectedUsed + 1, updated_at: new Date().toISOString() })
      .eq("id", input.grantId)
      .eq("user_id", input.userId) // defense-in-depth; grantId already came from this user's grants
      .eq("enabled", true)
      .is("revoked_at", null)
      .eq("generations_used", input.expectedUsed) // compare-and-swap: no double-take, bounds ceiling
      .select("generations_used, max_generations");
    if (error) {
      throw new Error(`video-access consume failed: ${error.message ?? error.code ?? "unknown"}`);
    }
    const rows = (data as { generations_used: number; max_generations: number }[] | null) ?? [];
    if (rows.length === 1) {
      const { generations_used, max_generations } = rows[0];
      return { consumed: true, remainingGenerations: Math.max(0, max_generations - generations_used) };
    }
    return { consumed: false, remainingGenerations: null };
  }
}

// Supabase-backed AssetStore (public.assets) — maps the camelCase `Asset`/`NewAsset`
// shapes (src/lib/assets/types.ts) onto the snake_case `assets` table (supabase/
// migrations/20260715171914_creative_studio_video.sql — authored, NOT applied). The
// constructor takes the REAL Supabase client type; every `.from(...)` call site narrows
// the result to a small local `AssetsQueryBuilder` shape via `as unknown as` so TS never
// structurally compares the whole recursive Postgrest builder type against a hand-rolled
// interface (that comparison is what blows up with TS2589 — see
// src/lib/creative-jobs/wiring.ts for the compile-time regression guard). A test fake
// needs no SDK import at all — just an object literal cast with `as never` at the call
// site.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Asset,
  AssetKind,
  AssetLifecycle,
  AssetProvenance,
  AssetStore,
  NewAsset,
} from "@/lib/assets/types";
import { PG_UNIQUE_VIOLATION, UniqueViolationError } from "@/lib/db/pg-errors";

// Re-exported for backward compatibility: callers/tests historically imported
// `UniqueViolationError` from this module. The canonical class now lives in
// src/lib/db/pg-errors.ts (shared with @/lib/creative-jobs/jobs) so an `instanceof`
// check works across store boundaries.
export { UniqueViolationError };

const TABLE = "assets";

type PgError = { code?: string; message?: string } | null;

interface AssetRow {
  id: string;
  listing_id: string;
  owner_id: string;
  kind: string;
  version: number;
  parent_asset: string | null;
  source_type: string;
  source_id: string | null;
  provenance: unknown;
  storage_bucket: string;
  storage_path: string;
  checksum: string | null;
  bytes: number;
  mime: string;
  cost_usd: number;
  cost_provider: string | null;
  created_by: string;
  lifecycle: string;
  qa: unknown;
  policy: unknown;
  created_at: string;
}

// The subset of a Postgrest query-builder this file relies on: chainable filters that
// are ALSO directly awaitable (mirrors the real @supabase/supabase-js builder, which is
// simultaneously thenable and chainable) plus the terminal `.maybeSingle()`.
interface AssetsQueryBuilder extends PromiseLike<{ data: unknown; error: PgError }> {
  eq(col: string, val: string): AssetsQueryBuilder;
  order(col: string, opts: { ascending: boolean }): AssetsQueryBuilder;
  select(cols?: string): AssetsQueryBuilder;
  maybeSingle(): PromiseLike<{ data: unknown; error: PgError }>;
}

interface AssetsTable {
  insert(row: unknown): AssetsQueryBuilder;
  select(cols?: string): AssetsQueryBuilder;
}

// Any object with a structurally-compatible `.from(...)` — the real `SupabaseClient`
// qualifies, as does a hand-rolled test fake. Narrowing happens per-call below via
// `as unknown as AssetsTable`, NOT here: the real client's `.from(table)` return type is
// a deeply recursive generic (PostgrestQueryBuilder) that TS cannot cheaply compare
// against `AssetsTable` at the call site type — going through `unknown` first sidesteps
// that structural comparison instead of triggering TS2589 ("Type instantiation is
// excessively deep and possibly infinite").
function assetsTable(client: SupabaseClient): AssetsTable {
  return client.from(TABLE) as unknown as AssetsTable;
}

function pgMessage(error: PgError): string {
  return error?.message ?? "unknown error";
}

function toInsertRow(a: NewAsset): Record<string, unknown> {
  return {
    listing_id: a.listingId,
    owner_id: a.ownerId,
    kind: a.kind,
    version: a.version,
    parent_asset: a.parentAsset,
    source_type: a.sourceType,
    source_id: a.sourceId,
    provenance: a.provenance,
    storage_bucket: a.storageBucket,
    storage_path: a.storagePath,
    checksum: a.checksum,
    bytes: a.bytes,
    mime: a.mime,
    cost_usd: a.costUsd,
    cost_provider: a.costProvider,
    created_by: a.createdBy,
    lifecycle: a.lifecycle,
    qa: a.qa,
    policy: a.policy,
  };
}

function fromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    listingId: row.listing_id,
    ownerId: row.owner_id,
    kind: row.kind as AssetKind,
    version: row.version,
    parentAsset: row.parent_asset,
    sourceType: row.source_type,
    sourceId: row.source_id,
    provenance: row.provenance as AssetProvenance,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    checksum: row.checksum,
    bytes: row.bytes,
    mime: row.mime,
    costUsd: row.cost_usd,
    costProvider: row.cost_provider,
    createdBy: row.created_by,
    lifecycle: row.lifecycle as AssetLifecycle,
    qa: row.qa,
    policy: row.policy,
    createdAt: row.created_at,
  };
}

// Real integration: Supabase Postgres via the service-role client (server/worker
// context only — see src/lib/supabase/service.ts). Never mutates an existing row:
// `insert` is the only write path, matching the AssetStore port's structural
// immutability (no update/replace-bytes method exists on the interface at all).
export class SupabaseAssetStore implements AssetStore {
  constructor(private readonly client: SupabaseClient) {}

  async insert(asset: NewAsset): Promise<Asset> {
    const { data, error } = await assetsTable(this.client)
      .insert(toInsertRow(asset))
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new UniqueViolationError(error.message);
      }
      throw new Error(`assets insert failed: ${pgMessage(error)}`);
    }
    if (!data) throw new Error("assets insert failed: no row returned");
    return fromRow(data as AssetRow);
  }

  async findBySource(sourceType: string, sourceId: string): Promise<Asset | null> {
    const { data, error } = await assetsTable(this.client)
      .select("*")
      .eq("source_type", sourceType)
      .eq("source_id", sourceId)
      .maybeSingle();
    if (error) throw new Error(`assets findBySource failed: ${pgMessage(error)}`);
    return data ? fromRow(data as AssetRow) : null;
  }

  async listByListing(listingId: string): Promise<Asset[]> {
    const { data, error } = await assetsTable(this.client)
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`assets listByListing failed: ${pgMessage(error)}`);
    return ((data as AssetRow[] | null) ?? []).map(fromRow);
  }

  async getById(id: string): Promise<Asset | null> {
    const { data, error } = await assetsTable(this.client).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`assets getById failed: ${pgMessage(error)}`);
    return data ? fromRow(data as AssetRow) : null;
  }
}

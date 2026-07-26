// F4.6 Stage C — the concrete Supabase ArchiveWriter: ONE guarded conditional UPDATE + the
// idempotent activity_log audit (F4.1 ensure pattern). See design §4 (atomic primitive) and §5
// (audit strategy) in docs/superpowers/plans/2026-07-23-f4.6-asset-archive-design.md.
//
// PRINCIPLES (enforced by this module's shape):
// - Archive never makes decisions: every value in the WHERE comes verbatim from the
//   ArchiveCommand (the F4.5 plan). No current re-selection, no candidate generation, no
//   ordering, no lifecycle interpretation.
// - No pre-read / no read→decide→update: ALL protection lives in the UPDATE's WHERE. The only
//   read is POST-HOC, after a 0-row result, purely to LABEL the outcome (design §3: "an
//   optional getById may refine the log label only") — it can no longer influence what was
//   (not) written.
// - Service client ONLY (assets has no seller UPDATE policy; RLS denies non-service writes by
//   construction). No endpoint, no HTTP action, no job, no cron lives here.
// - This is NOT an AssetStore and gains no other methods (AssetStore stays append-only).
import type { ArchiveCommand, ArchiveOutcome, ArchiveWriter } from "@/lib/creative-studio/source-archive";
import {
  SOURCE_ASSET_ARCHIVED_ACTION,
  ensureSourceAssetArchivedAudit,
  type ArchiveAuditPort,
  type SourceAssetArchivedEntry,
} from "@/lib/creative-studio/source-archive-audit";
import { UniqueViolationError, isUniqueViolation } from "@/lib/db/pg-errors";

// Minimal structural view of the service client — only what this writer actually calls.
// (Mirrors the SupabaseAssetStore approach: no hard dependency on the full client type.)
interface UpdateChain {
  eq(column: string, value: string): UpdateChain;
  neq(column: string, value: string): UpdateChain;
  select(columns: string): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
interface SelectChain {
  eq(column: string, value: string): SelectChain;
  limit(n: number): SelectChain;
  maybeSingle(): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
export interface ArchiveWriterClient {
  from(table: string): {
    update(values: Record<string, unknown>): UpdateChain;
    select(columns: string): SelectChain;
    insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string; message?: string } | null }>;
  };
}

interface LabelRow {
  id: string;
  owner_id: string;
  lifecycle: string;
  archived_at: string | null;
}

export class SupabaseArchiveWriter implements ArchiveWriter {
  private readonly client: ArchiveWriterClient;
  private readonly now: () => string;
  private readonly auditMaxAttempts?: number;

  constructor(client: ArchiveWriterClient, opts: { now?: () => string; auditMaxAttempts?: number } = {}) {
    this.client = client;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.auditMaxAttempts = opts.auditMaxAttempts;
  }

  async archive(command: ArchiveCommand): Promise<ArchiveOutcome> {
    const archivedAt = this.now();

    // THE atomic primitive (design §4): a single guarded conditional UPDATE. 1 row = flipped;
    // 0 rows = nothing changed (already archived / not found / not owner / is current). All
    // four guards live in the WHERE — atomic in Postgres, no RPC, no pre-read.
    const { data, error } = await this.client
      .from("assets")
      .update({ lifecycle: "archived", archived_at: archivedAt })
      .eq("id", command.assetId)
      .eq("owner_id", command.ownerId)
      .neq("id", command.currentId) // current-protection; authority-supplied, NEVER reselected
      .neq("lifecycle", "archived") // idempotency
      .select("id, listing_id");
    if (error) throw new Error(`archive UPDATE failed: ${error.message ?? error.code ?? "unknown"}`);

    const rows = (data as { id: string }[] | null) ?? [];
    if (rows.length === 1) {
      // Flip is durable. Ensure the audit (evidence, not a guard). If it cannot be ensured,
      // throw: the batch records an "error" result and a retry converges — the retry's UPDATE
      // returns 0 rows → already_archived → the audit is re-ensured (repaired) there.
      const ensured = await this.ensureAudit(command, archivedAt);
      if (!ensured) throw new Error("archived_but_audit_not_ensured (retry repairs the audit)");
      return "archived";
    }

    // 0 rows → POST-HOC LABEL READ (never decides a write; the write already didn't happen).
    const { data: row } = await this.client
      .from("assets")
      .select("id, owner_id, lifecycle, archived_at")
      .eq("id", command.assetId)
      .limit(1)
      .maybeSingle();
    const found = (row as LabelRow | null) ?? null;

    if (!found || found.owner_id !== command.ownerId) return "not_found_or_not_owner";
    if (found.id === command.currentId) return "skipped_current"; // invariant alarm — plan never emits current
    if (found.lifecycle === "archived") {
      // Idempotent path (raced or prior run). Repair a possibly-missing audit: find-or-insert
      // converges on exactly ONE event — it never duplicates an existing one.
      await this.ensureAudit(command, found.archived_at ?? archivedAt);
      return "already_archived";
    }
    // Guards said no, yet the row is active, owner-matched, and non-current — inexplicable.
    throw new Error("archive_guard_mismatch: 0 rows updated but the row appears archivable");
  }

  private async ensureAudit(command: ArchiveCommand, archivedAt: string): Promise<boolean> {
    // Operational fields + the audit-only value object, merged into the event payload. The
    // separation in ArchiveCommand makes explicit that `command.audit` never fed the WHERE.
    const entry: SourceAssetArchivedEntry = {
      ownerId: command.ownerId,
      listingId: command.audit.listingId,
      assetId: command.assetId,
      runId: command.runId,
      reason: command.reason,
      prevLifecycle: command.audit.prevLifecycle,
      archivedAt,
    };
    const { ensured } = await ensureSourceAssetArchivedAudit(this.auditPort(), entry, {
      maxAttempts: this.auditMaxAttempts,
    });
    return ensured;
  }

  // Concrete ArchiveAuditPort against activity_log — mirrors the F4.1 adapter exactly.
  private auditPort(): ArchiveAuditPort {
    const client = this.client;
    return {
      async exists({ ownerId, listingId, assetId }) {
        const { data } = await client
          .from("activity_log")
          .select("id")
          .eq("action_type", SOURCE_ASSET_ARCHIVED_ACTION)
          .eq("user_id", ownerId)
          .eq("property_id", listingId)
          .eq("metadata->>assetId", assetId)
          .limit(1)
          .maybeSingle();
        return Boolean(data);
      },
      async insert(entry) {
        // Non-sensitive metadata only. A 23505 (from the authored partial unique index) means
        // a concurrent insert won — surfaced as UniqueViolationError so the ensure-helper
        // treats it as done.
        const { error } = await client.from("activity_log").insert({
          user_id: entry.ownerId,
          property_id: entry.listingId,
          action_type: SOURCE_ASSET_ARCHIVED_ACTION,
          description: "Source video archived by retention",
          metadata: {
            assetId: entry.assetId,
            listingId: entry.listingId,
            ownerId: entry.ownerId,
            runId: entry.runId,
            reason: entry.reason,
            prevLifecycle: entry.prevLifecycle,
            archivedAt: entry.archivedAt,
          },
        });
        if (error) {
          if (isUniqueViolation(error)) throw new UniqueViolationError();
          throw new Error(`audit insert failed: ${error.message ?? error.code ?? "unknown"}`);
        }
      },
    };
  }
}

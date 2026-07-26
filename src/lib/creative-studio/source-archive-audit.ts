// F4.6 Stage C — idempotent, repairable audit for Source Asset archive. Applies the F4.1
// ensure-audit pattern (source-audit.ts) verbatim: stable event identity, find-or-insert with
// bounded retries, and a UniqueViolationError from a losing concurrent insert treated as
// "already ensured" (requires the authored partial unique index
// activity_log_source_asset_archived_unique — see the Stage C migration).
//
// The audit is EVIDENCE, not a guard (design §4): the safety-critical properties (never archive
// the current; idempotency) live entirely in the ArchiveWriter's single conditional UPDATE. A
// re-run repairs a missing audit via this same find-or-insert — it never duplicates one.
//
// No second audit table (reuses `activity_log`); no timestamp as an idempotency key.
import { UniqueViolationError } from "@/lib/db/pg-errors";

export const SOURCE_ASSET_ARCHIVED_ACTION = "creative_studio.source_asset_archived";
export const ARCHIVE_AUDIT_ENSURE_MAX_ATTEMPTS = 3;

// Stable identity of the event (the idempotency key): matches the partial unique index
// (user_id, property_id, metadata->>'assetId') for this action_type.
export interface SourceAssetArchivedIdentity {
  ownerId: string; // → activity_log.user_id
  listingId: string; // → activity_log.property_id
  assetId: string; // → activity_log.metadata.assetId
}

// Full event payload — identity + non-sensitive metadata only. All values are DATA handed to
// the writer (from the plan / the flip); nothing here is derived or interpreted.
export interface SourceAssetArchivedEntry extends SourceAssetArchivedIdentity {
  runId: string;
  reason: string;
  prevLifecycle: string; // reversibility target — from the plan, never re-read
  archivedAt: string; // ISO timestamp set atomically with the flip
}

export interface ArchiveAuditPort {
  exists(identity: SourceAssetArchivedIdentity): Promise<boolean>;
  insert(entry: SourceAssetArchivedEntry): Promise<void>;
}

// Find-or-insert with bounded retries (F4.1 pattern). Returns { ensured: false } only if the
// event could neither be found nor inserted after `maxAttempts` — the caller must then NOT
// claim the archive complete (the flip is durable; a retry repairs the audit).
export async function ensureSourceAssetArchivedAudit(
  port: ArchiveAuditPort,
  entry: SourceAssetArchivedEntry,
  opts: { maxAttempts?: number } = {},
): Promise<{ ensured: boolean }> {
  const maxAttempts = opts.maxAttempts ?? ARCHIVE_AUDIT_ENSURE_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (await port.exists(entry)) return { ensured: true };
      await port.insert(entry);
      return { ensured: true };
    } catch (err) {
      if (err instanceof UniqueViolationError) return { ensured: true }; // concurrent insert won the race
      if (attempt === maxAttempts) return { ensured: false }; // transient failure, exhausted
    }
  }
  return { ensured: false };
}

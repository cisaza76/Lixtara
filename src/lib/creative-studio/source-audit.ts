// F4.1 (correction 1) — idempotent, repairable audit for the seller source-video upload.
// `/complete` must guarantee BOTH a durable Source Asset AND a durable audit event. The
// event's identity is stable (action_type + user_id + property_id + uploadId) so a repeated
// /complete never duplicates it and a prior audit failure can be REPAIRED on retry.
//
// No second audit table (reuses `activity_log`); no timestamp as an idempotency key; no
// signed URL / token / secret in the payload.
import { UniqueViolationError } from "@/lib/db/pg-errors";

export const VIDEO_SOURCE_UPLOADED_ACTION = "creative_studio.video_source_uploaded";
export const AUDIT_ENSURE_MAX_ATTEMPTS = 3;

// Stable identity of the event (the idempotency key).
export interface VideoSourceAuditIdentity {
  userId: string;
  listingId: string; // → activity_log.property_id
  uploadId: string; // → activity_log.metadata.uploadId
}

// Full event payload — identity + non-sensitive metadata only.
export interface VideoSourceAuditEntry extends VideoSourceAuditIdentity {
  assetId: string;
  sizeBytes: number;
  mimeType: string | null;
}

// Injected persistence. `insert` MUST throw UniqueViolationError when a concurrent insert
// already created the event — which requires the authored partial unique index on
// activity_log (see the F4.1 correction migration). Without that index applied, two truly
// concurrent /complete calls could each pass `exists()` and both insert (a duplicate);
// with it, the loser's insert violates the index and is caught below as "already ensured".
export interface AuditPort {
  exists(identity: VideoSourceAuditIdentity): Promise<boolean>;
  insert(entry: VideoSourceAuditEntry): Promise<void>;
}

// Find-or-insert with bounded retries. Returns { ensured: false } only if the event could
// neither be found nor inserted after `maxAttempts` (a transient DB problem) — the caller
// must then NOT claim the operation complete and return a retryable error (the Asset is
// kept, never deleted). Concurrency-safe given the unique index (a losing insert →
// UniqueViolationError → treated as ensured).
export async function ensureVideoSourceUploadedAudit(
  port: AuditPort,
  entry: VideoSourceAuditEntry,
  opts: { maxAttempts?: number } = {},
): Promise<{ ensured: boolean }> {
  const maxAttempts = opts.maxAttempts ?? AUDIT_ENSURE_MAX_ATTEMPTS;
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

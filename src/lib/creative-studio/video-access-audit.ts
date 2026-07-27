// Gate 5 pre-rollout — the audit trail for uploaded_video access decisions and quota consumption,
// plus the (structurally prepared) internal-consent record. Reuses `activity_log` (no new audit
// table), mirroring the F4.1/F4.6 audit doctrine: events are EVIDENCE, never guards.
//
// Two kinds of event live here:
//  - Telemetry (appended once per request): a generation was REQUESTED or BLOCKED, or a quota
//    slot was CONSUMED. These record what the server decided; they never gate anything.
//  - Consent (find-or-insert, idempotent): an internal reviewer recorded acceptance of the
//    uploaded_video disclosure for a (user, listing, source asset). Structurally ready for the
//    5B seller-facing path; in 5A the authority reports consentRequired=false, so the generate
//    route consults `hasInternalConsent` only when a future grant sets consentRequired.
//
// NOTHING here writes to production in this PR — recording consent (Gate 5A execution) is out of
// scope. The code path exists and is tested; issuing real acceptances is a separate, gated step.
import { UniqueViolationError } from "@/lib/db/pg-errors";

export const VIDEO_GENERATION_REQUESTED_ACTION = "creative_studio.video_generation_requested";
export const VIDEO_ACCESS_BLOCKED_ACTION = "creative_studio.video_access_blocked";
export const VIDEO_QUOTA_CONSUMED_ACTION = "creative_studio.video_quota_consumed";
export const VIDEO_CONSENT_RECORDED_ACTION = "creative_studio.video_consent_recorded";
export const CONSENT_ENSURE_MAX_ATTEMPTS = 3;

// Minimal structural view of the activity_log side of the service client — only what this module
// writes/reads. (Mirrors ArchiveAuditPort; the concrete impl is built from createService().)
export interface ActivityLogPort {
  insert(row: {
    user_id: string;
    property_id: string;
    action_type: string;
    description: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  exists(query: { userId: string; listingId: string; actionType: string; sourceAssetId: string }): Promise<boolean>;
}

// ── Telemetry (append-only) ─────────────────────────────────────────────────────────────────
// These never carry PII: ids and enum-like reasons only, no file names, no signed URLs, no
// error text. A failed insert must NOT fail the user's request — auditing is best-effort here
// (the security decision already happened); we swallow and return false so callers can log.

export interface AccessEvent {
  userId: string;
  listingId: string;
  metadata: Record<string, unknown>;
}

async function appendBestEffort(port: ActivityLogPort, action: string, description: string, e: AccessEvent): Promise<boolean> {
  try {
    await port.insert({
      user_id: e.userId,
      property_id: e.listingId,
      action_type: action,
      description,
      metadata: e.metadata,
    });
    return true;
  } catch {
    return false; // best-effort: never break the request over a missed audit line
  }
}

export function auditGenerationRequested(port: ActivityLogPort, e: AccessEvent): Promise<boolean> {
  return appendBestEffort(port, VIDEO_GENERATION_REQUESTED_ACTION, "Uploaded video generation requested", e);
}

export function auditAccessBlocked(port: ActivityLogPort, e: AccessEvent): Promise<boolean> {
  return appendBestEffort(port, VIDEO_ACCESS_BLOCKED_ACTION, "Uploaded video access blocked", e);
}

export function auditQuotaConsumed(port: ActivityLogPort, e: AccessEvent): Promise<boolean> {
  return appendBestEffort(port, VIDEO_QUOTA_CONSUMED_ACTION, "Uploaded video quota consumed", e);
}

// ── Consent (find-or-insert, idempotent) ────────────────────────────────────────────────────

export interface ConsentRecord {
  userId: string; // → activity_log.user_id (the seller/account the consent is FOR)
  listingId: string; // → activity_log.property_id
  sourceAssetId: string; // → activity_log.metadata.sourceAssetId (identity component)
  approvedBy: string; // the internal reviewer who recorded acceptance
  disclosureVersion: string; // versioned disclosure text the acceptance is bound to
  acceptedAt: string; // ISO timestamp
}

// Has an internal consent been recorded for this (user, listing, source asset)? Read-only; used
// by the generate route ONLY when the grant marks consentRequired (5B). Never throws to the
// caller as "granted" — a read error propagates so the route fails closed.
export function hasInternalConsent(
  port: ActivityLogPort,
  q: { userId: string; listingId: string; sourceAssetId: string },
): Promise<boolean> {
  return port.exists({ ...q, actionType: VIDEO_CONSENT_RECORDED_ACTION });
}

// Record an internal consent acceptance, idempotently (find-or-insert with bounded retries — the
// F4.1 pattern). Returns { ensured:false } if it could neither be found nor inserted. STRUCTURAL:
// not invoked against production in this PR (Gate 5A execution is out of scope).
export async function recordInternalConsent(
  port: ActivityLogPort,
  record: ConsentRecord,
  opts: { maxAttempts?: number } = {},
): Promise<{ ensured: boolean }> {
  const maxAttempts = opts.maxAttempts ?? CONSENT_ENSURE_MAX_ATTEMPTS;
  const identity = { userId: record.userId, listingId: record.listingId, sourceAssetId: record.sourceAssetId };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (await hasInternalConsent(port, identity)) return { ensured: true };
      await port.insert({
        user_id: record.userId,
        property_id: record.listingId,
        action_type: VIDEO_CONSENT_RECORDED_ACTION,
        description: "Uploaded video internal consent recorded",
        metadata: {
          sourceAssetId: record.sourceAssetId,
          approvedBy: record.approvedBy,
          disclosureVersion: record.disclosureVersion,
          acceptedAt: record.acceptedAt,
        },
      });
      return { ensured: true };
    } catch (err) {
      if (err instanceof UniqueViolationError) return { ensured: true }; // concurrent insert won
      if (attempt === maxAttempts) return { ensured: false };
    }
  }
  return { ensured: false };
}

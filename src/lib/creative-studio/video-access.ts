// Gate 5 pre-rollout — the single server-side authority for "may this user use the uploaded_video
// feature for this listing?" (spec v2, frozen). Consulted by every video surface (dashboard +
// the initiate/complete/generate/status/preview routes). The UI only REFLECTS this result; it is
// never the authority.
//
// Reads the `creative_studio_video_access` allowlist EXCLUSIVELY via the service-role client
// (RLS on that table is deny-all, so a browser/authenticated client sees nothing and cannot
// self-authorize). `userId` MUST come from the authenticated session and `listingId` MUST have
// passed the route's ownership check before this runs — this module trusts neither from the body.
//
// FAIL-CLOSED by construction: an empty table, a missing/disabled/revoked/expired grant, an
// exhausted quota, OR a reader error all deny access. The dependency-injected `AccessReader`
// keeps the decision logic pure and unit-testable without Supabase.
import type { SentryLikeClient } from "@/lib/observability/sentry.server";

export type VideoAccessReason =
  | "allowed"
  | "no_grant"
  | "disabled"
  | "revoked"
  | "not_yet_valid"
  | "expired"
  | "listing_out_of_scope"
  | "quota_exhausted"
  | "reader_error";

export interface VideoAccessResult {
  allowed: boolean;
  reason: VideoAccessReason;
  userAllowed: boolean; // has ANY active, in-window, enabled grant (ignoring listing scope + quota)
  listingAllowed: boolean; // that grant covers this listing (scope satisfied)
  remainingGenerations: number; // never negative
  consentRequired: boolean; // structural flag for 5B; false for 5A internal-consent path
  consentSatisfied: boolean;
  grantId?: string; // the row to consume quota against, present only when allowed
}

// One active grant row, as returned by the reader. `listingId === null` means "all the user's
// listings". Timestamps are ISO strings (or null). The reader returns only NON-revoked rows.
export interface VideoAccessGrant {
  id: string;
  userId: string;
  listingId: string | null;
  enabled: boolean;
  maxGenerations: number;
  generationsUsed: number;
  validFrom: string | null;
  validUntil: string | null;
  revokedAt: string | null;
}

export interface AccessReader {
  // All active (revoked_at is null) grants for the user. The concrete impl uses the service-role
  // client; tests inject a fake. MUST throw on a real DB error so we can fail closed + log.
  listActiveGrants(userId: string): Promise<VideoAccessGrant[]>;
}

// Result of attempting to consume ONE generation from a grant. `consumed` is true only when the
// guarded conditional UPDATE flipped exactly one row (quota was available, grant still
// enabled/not-revoked, and no concurrent consumer moved it first). false means the slot was NOT
// taken — exhausted, revoked, disabled, or a lost compare-and-swap race.
export interface QuotaConsumeResult {
  consumed: boolean;
  remainingGenerations: number | null; // remaining AFTER this consume; null when not consumed
}

export interface QuotaConsumer {
  // Atomically consume one generation against `grantId`. `expectedUsed` is the generations_used
  // value the caller read from the grant (compare-and-swap guard), so two concurrent consumers
  // can never both take the same slot. MUST be called at most once per logical job (see
  // createJob's `created` flag) — quota is a safety rail, not a billing meter (spec v2 §0).
  consumeGeneration(input: {
    grantId: string;
    userId: string;
    expectedUsed: number;
  }): Promise<QuotaConsumeResult>;
}

export interface VideoAccessDeps {
  reader: AccessReader;
  now: () => number; // injectable clock (ms) for window checks
  sentry?: SentryLikeClient | null; // sanitized capture on reader error; never receives PII
}

const deny = (reason: VideoAccessReason): VideoAccessResult => ({
  allowed: false,
  reason,
  userAllowed: reason !== "no_grant" && reason !== "reader_error",
  listingAllowed: false,
  remainingGenerations: 0,
  consentRequired: false,
  consentSatisfied: false,
});

// A grant is "active for the user" if enabled, not revoked (reader already filters), and within
// its optional validity window. Scope + quota are evaluated separately.
function isWithinWindow(grant: VideoAccessGrant, nowMs: number): VideoAccessReason | null {
  if (!grant.enabled) return "disabled";
  if (grant.revokedAt !== null) return "revoked"; // defensive; reader should exclude these
  if (grant.validFrom !== null && nowMs < Date.parse(grant.validFrom)) return "not_yet_valid";
  if (grant.validUntil !== null && nowMs > Date.parse(grant.validUntil)) return "expired";
  return null;
}

// Prefer a listing-specific grant over an "all listings" grant when both exist for the listing,
// so a per-listing quota is honored ahead of a blanket one. Deterministic + total.
function pickGrantForListing(
  grants: VideoAccessGrant[],
  listingId: string,
  nowMs: number,
): { grant: VideoAccessGrant | null; anyUserGrant: boolean; windowReason: VideoAccessReason | null } {
  let anyUserGrant = false;
  let firstWindowReason: VideoAccessReason | null = null;
  const specific: VideoAccessGrant[] = [];
  const blanket: VideoAccessGrant[] = [];
  for (const g of grants) {
    const w = isWithinWindow(g, nowMs);
    if (w !== null) {
      firstWindowReason ??= w;
      continue; // out-of-window grants don't count
    }
    anyUserGrant = true; // an enabled, in-window grant exists for the user
    if (g.listingId === listingId) specific.push(g);
    else if (g.listingId === null) blanket.push(g);
  }
  const grant = specific[0] ?? blanket[0] ?? null;
  return { grant, anyUserGrant, windowReason: firstWindowReason };
}

// The decision. `listingId` MUST already be owner-verified by the caller.
export async function requireVideoFeatureAccess(
  deps: VideoAccessDeps,
  input: { userId: string; listingId: string },
): Promise<VideoAccessResult> {
  if (!input.userId || !input.listingId) return deny("no_grant");

  let grants: VideoAccessGrant[];
  try {
    grants = await deps.reader.listActiveGrants(input.userId);
  } catch (err) {
    // Fail closed and record a content-free signal (no userId/listingId values, no error text).
    deps.sentry?.captureException(err, { tags: { surface: "video_access", outcome: "reader_error" } });
    return deny("reader_error");
  }

  const nowMs = deps.now();
  const { grant, anyUserGrant, windowReason } = pickGrantForListing(grants, input.listingId, nowMs);

  if (grant === null) {
    // No grant covers this listing. Distinguish "user has an in-window grant but not for this
    // listing" (out of scope) from "user has no usable grant at all" (no_grant / window reason).
    if (anyUserGrant) return { ...deny("listing_out_of_scope"), userAllowed: true };
    return deny(windowReason ?? "no_grant");
  }

  const remaining = Math.max(0, grant.maxGenerations - grant.generationsUsed);
  if (remaining <= 0) {
    return { ...deny("quota_exhausted"), userAllowed: true, listingAllowed: true, grantId: grant.id };
  }

  // Consent is evaluated by the route against the resolved source asset (5B); this authority
  // reports it as "not required" for the 5A internal path. `consentSatisfied` is set by the
  // caller when it has checked a consent record.
  return {
    allowed: true,
    reason: "allowed",
    userAllowed: true,
    listingAllowed: true,
    remainingGenerations: remaining,
    consentRequired: false,
    consentSatisfied: true,
    grantId: grant.id,
  };
}

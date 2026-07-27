// Gate 5 pre-rollout — the real-wiring adapter that every video surface calls. It binds the pure
// authority (requireVideoFeatureAccess) to the service-role store, and maps a denial to the HTTP
// shape the routes return. Keeping the mapping HERE (not in each route) guarantees all six
// surfaces answer identically: the feature is INVISIBLE (404) to anyone not allowlisted or out of
// scope, and an allowlisted seller merely out of quota gets a distinguishable 403.
import { createService } from "@/lib/supabase/service";
import { getRegisteredSentryClient, type SentryLikeClient } from "@/lib/observability/sentry.server";
import {
  requireVideoFeatureAccess,
  type QuotaConsumer,
  type VideoAccessDeps,
  type VideoAccessResult,
} from "@/lib/creative-studio/video-access";
import { SupabaseVideoAccessStore, type VideoAccessClient } from "@/lib/creative-studio/video-access.supabase";
import type { ActivityLogPort } from "@/lib/creative-studio/video-access-audit";
import { UniqueViolationError, isUniqueViolation } from "@/lib/db/pg-errors";

// The signature the routes depend on (injected, so tests stay pure). Returns the full result so a
// route can read remainingGenerations / grantId when it needs to consume quota afterward.
export type CheckVideoAccess = (input: { userId: string; listingId: string }) => Promise<VideoAccessResult>;

// A generic-error, tags-only Sentry adapter: forwards ONLY the PII-free tags the authority sets,
// never a caught error (getRegisteredSentryClient bypasses the pipeline scrubber, so we must).
function guardSentry(): SentryLikeClient {
  return {
    captureException(_error, context) {
      getRegisteredSentryClient()?.captureException(new Error("video_access reader_error"), context);
    },
  };
}

// One service-role store per call site is fine (createService is cheap); the store is stateless.
export function videoAccessStore(): SupabaseVideoAccessStore & QuotaConsumer {
  return new SupabaseVideoAccessStore(createService() as unknown as VideoAccessClient);
}

export function buildVideoAccessDeps(): VideoAccessDeps {
  return { reader: videoAccessStore(), now: () => Date.now(), sentry: guardSentry() };
}

// The default real check — used as each route's `checkAccess` dependency default.
export const checkVideoAccess: CheckVideoAccess = (input) =>
  requireVideoFeatureAccess(buildVideoAccessDeps(), input);

// The subset of `listingIds` for which the feature is VISIBLE to this user (allowlisted, in-scope
// — quota does not hide it). Reads the user's grants ONCE and evaluates every listing against that
// snapshot, so the dashboard render costs a single DB round-trip regardless of listing count.
// Fail-closed: any reader error yields an EMPTY set (no panels render). Lives here, not in the
// server-component body, so the impure clock/service calls stay out of React's render path.
export async function resolveVisibleVideoListings(userId: string, listingIds: string[]): Promise<Set<string>> {
  const visible = new Set<string>();
  if (listingIds.length === 0) return visible;
  try {
    const grants = await videoAccessStore().listActiveGrants(userId);
    const deps: VideoAccessDeps = {
      reader: { listActiveGrants: async () => grants },
      now: () => Date.now(),
      sentry: null,
    };
    for (const listingId of listingIds) {
      if (isVideoFeatureVisible(await requireVideoFeatureAccess(deps, { userId, listingId }))) {
        visible.add(listingId);
      }
    }
  } catch {
    // fail-closed: leave the set empty
  }
  return visible;
}

// Maps a non-allowed result to the HTTP denial the routes return; null when allowed.
//  - quota_exhausted → 403 { error: "quota_exhausted" } (feature is visible to this seller, just
//    out of generations — an actionable, honest signal).
//  - consent_required → 403 { error: "consent_required" } (structural; only reachable once a grant
//    sets consentRequired — the 5B path).
//  - everything else (no_grant / disabled / revoked / not_yet_valid / expired /
//    listing_out_of_scope / reader_error) → 404 { error: "not_found" }: the feature must be
//    INVISIBLE to non-allowlisted users, and a reader error must not reveal existence either.
export function videoAccessDenial(result: VideoAccessResult): { status: number; body: { error: string } } | null {
  if (result.allowed) return null;
  if (result.reason === "quota_exhausted") return { status: 403, body: { error: "quota_exhausted" } };
  if (result.consentRequired && !result.consentSatisfied) {
    return { status: 403, body: { error: "consent_required" } };
  }
  return { status: 404, body: { error: "not_found" } };
}

// Is the feature VISIBLE to this seller for this listing? True when they hold an allowlisted,
// in-scope grant — EVEN IF out of generations. Quota gates only the generate action; a seller who
// has spent their generations can still upload/replace source, preview, and read status. Used by
// the non-generating surfaces (initiate/complete/preview/status) and the dashboard panel.
export function isVideoFeatureVisible(result: VideoAccessResult): boolean {
  return result.allowed || result.reason === "quota_exhausted";
}

// The 404-or-nothing denial for those non-generating surfaces: invisible (404) unless visible.
export function videoVisibilityDenial(result: VideoAccessResult): { status: number; body: { error: string } } | null {
  return isVideoFeatureVisible(result) ? null : { status: 404, body: { error: "not_found" } };
}

// Concrete ActivityLogPort against activity_log — mirrors the F4.6 archive adapter. Built from the
// service-role client (activity_log has no seller insert policy). Used by the generate route's
// audit + the structural consent path.
export function activityLogPort(): ActivityLogPort {
  const client = createService();
  return {
    async insert(row) {
      const { error } = await client.from("activity_log").insert(row);
      if (error) {
        if (isUniqueViolation(error)) throw new UniqueViolationError();
        throw new Error(`activity_log insert failed: ${error.message ?? error.code ?? "unknown"}`);
      }
    },
    async exists({ userId, listingId, actionType, sourceAssetId }) {
      const { data } = await client
        .from("activity_log")
        .select("id")
        .eq("action_type", actionType)
        .eq("user_id", userId)
        .eq("property_id", listingId)
        .eq("metadata->>sourceAssetId", sourceAssetId)
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    },
  };
}

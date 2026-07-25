// Deterministic, LLM-free readiness. Answers ONLY: do the assets + listing state allow
// producing this capability at acceptable quality? Two orthogonal axes — `status` (hard)
// and `recommendation` (soft). Never reads plan, cost, or provider. Runs before any spend.
import type {
  CapabilityReadiness,
  Classification,
  MediaCapability,
  QualityScore,
  ReadinessReason,
  RoomType,
  SuggestedAction,
} from "@/lib/media-intelligence/types";

export const MIN_TOUR_PHOTOS = 8;
export const MIN_USABLE_QUALITY = 0.45;    // QualityScore.overall (0..1) floor to be READY for image work
export const RECOMMEND_MIN_INTERIORS = 3;  // interiors below this → video is ready but NOT recommended

const INTERIOR_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>([
  "sala", "cocina", "habitacion", "bano",
]);

export interface ReadinessContext {
  photoCount: number;
  scores: QualityScore[];
  classifications: Classification[];
  listingApproved: boolean;
}

export function evaluateCapabilityReadiness(
  capability: MediaCapability,
  ctx: ReadinessContext,
): CapabilityReadiness {
  const reasons: ReadinessReason[] = [];
  const suggestedActions: SuggestedAction[] = [];
  let status: "ready" | "not_ready" = "ready";
  let recommendation: "recommended" | "not_recommended" = "recommended";

  const interiorCount = ctx.classifications.filter((c) => INTERIOR_ROOMS.has(c.roomType)).length;
  const bestQuality = ctx.scores.reduce((m, s) => Math.max(m, s.overall), 0);

  if (capability === "tour" || capability === "three_d") {
    if (ctx.photoCount < MIN_TOUR_PHOTOS) {
      status = "not_ready";
      reasons.push({ code: "too_few_photos_for_tour", params: { min: MIN_TOUR_PHOTOS, have: ctx.photoCount } });
      suggestedActions.push({ code: "add_more_photos", params: { min: MIN_TOUR_PHOTOS } });
    }
  }

  if (capability === "video") {
    if (!ctx.listingApproved) {
      status = "not_ready";
      reasons.push({ code: "listing_not_approved" });
      suggestedActions.push({ code: "await_listing_approval" });
    }
    if (interiorCount === 0) {
      status = "not_ready";
      reasons.push({ code: "no_interior_photos" });
      suggestedActions.push({ code: "add_interior_photos", params: { min: RECOMMEND_MIN_INTERIORS } });
    } else if (interiorCount < RECOMMEND_MIN_INTERIORS) {
      recommendation = "not_recommended"; // ready but weak — advise, do not block
      reasons.push({ code: "few_interior_photos", params: { have: interiorCount, want: RECOMMEND_MIN_INTERIORS } });
      suggestedActions.push({ code: "add_interior_photos", params: { min: RECOMMEND_MIN_INTERIORS } });
    }
  }

  if (capability === "image") {
    if (bestQuality < MIN_USABLE_QUALITY) {
      status = "not_ready";
      reasons.push({ code: "low_photo_quality" });
      suggestedActions.push({ code: "improve_photo_quality" });
    }
  }

  if (status === "not_ready") recommendation = "not_recommended";

  return { capability, status, recommendation, reasons, suggestedActions };
}

export function evaluateReadiness(
  capabilities: readonly MediaCapability[],
  ctx: ReadinessContext,
): CapabilityReadiness[] {
  const seen = new Set<MediaCapability>();
  const out: CapabilityReadiness[] = [];
  for (const cap of capabilities) {
    if (seen.has(cap)) continue;
    seen.add(cap);
    out.push(evaluateCapabilityReadiness(cap, ctx));
  }
  return out;
}

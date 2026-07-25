import { describe, it, expect } from "vitest";
import {
  evaluateCapabilityReadiness,
  evaluateReadiness,
  MIN_TOUR_PHOTOS,
  RECOMMEND_MIN_INTERIORS,
} from "@/lib/media-intelligence/readiness";
import type { Classification, QualityScore } from "@/lib/media-intelligence/types";

const good: QualityScore = { photoId: "p1", sharpness: 0.8, lighting: 0.8, framing: 0.8, overall: 0.8 };
const interior = (id: string): Classification => ({ photoId: id, roomType: "sala", tags: [], confidence: 0.9 });
const exterior = (id: string): Classification => ({ photoId: id, roomType: "fachada", tags: [], confidence: 0.9 });
const interiors = (n: number) => Array.from({ length: n }, (_, i) => interior(`i${i}`));

describe("evaluateCapabilityReadiness", () => {
  it("marks a tour not_ready with a structured reason + action when photos are too few", () => {
    const r = evaluateCapabilityReadiness("tour", { photoCount: 4, scores: [good], classifications: interiors(4), listingApproved: true });
    expect(r.status).toBe("not_ready");
    expect(r.recommendation).toBe("not_recommended");
    expect(r.reasons).toEqual([{ code: "too_few_photos_for_tour", params: { min: MIN_TOUR_PHOTOS, have: 4 } }]);
    expect(r.suggestedActions[0].code).toBe("add_more_photos");
  });

  it("marks a tour ready when it has enough photos", () => {
    const r = evaluateCapabilityReadiness("tour", { photoCount: MIN_TOUR_PHOTOS, scores: [good], classifications: interiors(MIN_TOUR_PHOTOS), listingApproved: true });
    expect(r.status).toBe("ready");
    expect(r.reasons).toEqual([]);
  });

  it("blocks video with BOTH reasons when unapproved and no interiors", () => {
    const r = evaluateCapabilityReadiness("video", { photoCount: 6, scores: [good], classifications: [exterior("e1")], listingApproved: false });
    expect(r.status).toBe("not_ready");
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("listing_not_approved");
    expect(codes).toContain("no_interior_photos");
  });

  it("keeps video ready but NOT recommended when interiors are thin", () => {
    const r = evaluateCapabilityReadiness("video", { photoCount: 6, scores: [good], classifications: [interior("i0"), exterior("e1")], listingApproved: true });
    expect(r.status).toBe("ready");
    expect(r.recommendation).toBe("not_recommended");
    expect(r.reasons.map((x) => x.code)).toContain("few_interior_photos");
  });

  it("recommends video when approved with enough interiors", () => {
    const r = evaluateCapabilityReadiness("video", { photoCount: 8, scores: [good], classifications: interiors(RECOMMEND_MIN_INTERIORS), listingApproved: true });
    expect(r.status).toBe("ready");
    expect(r.recommendation).toBe("recommended");
    expect(r.reasons).toEqual([]);
  });

  it("marks image not_ready when the best photo quality is too low", () => {
    const bad: QualityScore = { photoId: "p1", sharpness: 0.1, lighting: 0.1, framing: 0.1, overall: 0.2 };
    const r = evaluateCapabilityReadiness("image", { photoCount: 5, scores: [bad], classifications: interiors(5), listingApproved: true });
    expect(r.status).toBe("not_ready");
    expect(r.reasons[0].code).toBe("low_photo_quality");
  });
});

describe("evaluateReadiness", () => {
  it("evaluates each capability independently and de-dupes", () => {
    const list = evaluateReadiness(["video", "tour", "video"], { photoCount: 4, scores: [good], classifications: interiors(4), listingApproved: true });
    expect(list.map((r) => r.capability)).toEqual(["video", "tour"]);
  });
});

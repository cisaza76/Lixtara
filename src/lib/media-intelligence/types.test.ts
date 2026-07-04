import { describe, it, expect } from "vitest";
import {
  MEDIA_CAPABILITIES,
  MEDIA_JOB_STATUSES,
  ROOM_TYPES,
  mediaStrategyDraftSchema,
  STRATEGY_SCHEMA_VERSION,
} from "@/lib/media-intelligence/types";

describe("media-intelligence types", () => {
  it("exposes the six capabilities and five job statuses", () => {
    expect(MEDIA_CAPABILITIES).toEqual([
      "video", "image", "presentation", "tour", "three_d", "voice",
    ]);
    expect(MEDIA_JOB_STATUSES).toEqual([
      "pending", "analyzing", "generating", "completed", "failed",
    ]);
  });

  it("includes core real-estate room types", () => {
    expect(ROOM_TYPES).toContain("fachada");
    expect(ROOM_TYPES).toContain("cocina");
    expect(ROOM_TYPES).toContain("aerea");
  });

  it("validates a well-formed strategy draft and rejects a bad one", () => {
    const ok = mediaStrategyDraftSchema.safeParse({
      targetAudience: "young families",
      buyerPersona: "first-time buyer",
      emotions: ["warmth"],
      highlightSpaces: ["cocina"],
      hideSpaces: [],
      narrativeOrder: ["fachada", "sala", "cocina"],
      visualStyle: "warm editorial",
      recommendedPlatforms: [{ platform: "instagram", rationale: "reach" }],
      recommendedDurationSec: 30,
      recommendedOutputs: [{ capability: "video", engine: "mock" }],
      bestRoiCombination: ["reel"],
      rationale: "because",
    });
    expect(ok.success).toBe(true);
    const bad = mediaStrategyDraftSchema.safeParse({ targetAudience: 123 });
    expect(bad.success).toBe(false);
  });

  it("pins the payload schema version", () => {
    expect(STRATEGY_SCHEMA_VERSION).toBe(1);
  });
});

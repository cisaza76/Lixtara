import { describe, it, expect } from "vitest";
import { buildStrategy } from "@/lib/media-intelligence/strategy";
import type { Classification, SelectedShot } from "@/lib/media-intelligence/types";

describe("buildStrategy", () => {
  it("validates the draft and fills cost deterministically from the cost table", async () => {
    const shots: SelectedShot[] = [
      { photoId: "a", order: 0, roomType: "fachada", reason: "", suggestedMotion: "push" },
    ];
    const classes: Classification[] = [{ photoId: "a", roomType: "fachada", tags: [], confidence: 1 }];
    const fakeGenerate = async () => ({
      object: {
        targetAudience: "families", buyerPersona: "upgrader", emotions: ["warmth"],
        highlightSpaces: ["cocina"], hideSpaces: [], narrativeOrder: ["fachada"],
        visualStyle: "warm editorial",
        recommendedPlatforms: [{ platform: "instagram", rationale: "reach" }],
        recommendedDurationSec: 30,
        recommendedOutputs: [{ capability: "video", engine: "veo" }],
        bestRoiCombination: ["vertical_reel"], rationale: "because",
      },
    });
    const s = await buildStrategy(shots, classes, { price: 500000, beds: 3, baths: 2, city: "Miami" }, { generate: fakeGenerate as never });
    expect(s.targetAudience).toBe("families");
    // cost filled from cost-table for veo/video (> 0), NOT from the model
    expect(s.recommendedOutputs[0].estimatedCostUsd).toBeGreaterThan(0);
  });

  it("throws when the model output fails schema validation", async () => {
    const fakeGenerate = async () => ({ object: { targetAudience: 123 } });
    await expect(
      buildStrategy([], [], { price: 0, beds: 0, baths: 0, city: "x" }, { generate: fakeGenerate as never }),
    ).rejects.toThrow();
  });
});

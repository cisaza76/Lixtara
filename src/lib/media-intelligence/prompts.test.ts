import { describe, it, expect } from "vitest";
import { buildGenerationPrompts, GEOMETRY_GUARDRAILS } from "@/lib/media-intelligence/prompts";
import type { MediaStrategy, SelectedShot } from "@/lib/media-intelligence/types";

const strategy: MediaStrategy = {
  targetAudience: "families", buyerPersona: "upgrader", emotions: ["warmth"],
  highlightSpaces: ["cocina"], hideSpaces: [], narrativeOrder: [],
  visualStyle: "warm editorial", recommendedPlatforms: [], recommendedDurationSec: 30,
  recommendedOutputs: [], bestRoiCombination: [], rationale: "r",
};
const shots: SelectedShot[] = [
  { photoId: "a", order: 0, roomType: "fachada", reason: "", suggestedMotion: "push-in" },
];

describe("buildGenerationPrompts", () => {
  it("produces one prompt per shot carrying geometry guardrails", () => {
    const out = buildGenerationPrompts(shots, strategy);
    expect(out).toHaveLength(1);
    expect(out[0].photoId).toBe("a");
    expect(out[0].shotOrder).toBe(0);
    expect(out[0].guardrails).toBe(GEOMETRY_GUARDRAILS);
    expect(out[0].prompt).toContain("push-in");
    expect(out[0].prompt.toLowerCase()).toContain("source of truth");
  });
  it("guardrails forbid inventing geometry", () => {
    expect(GEOMETRY_GUARDRAILS.toLowerCase()).toContain("do not add");
    expect(GEOMETRY_GUARDRAILS.toLowerCase()).toContain("walls");
  });
});

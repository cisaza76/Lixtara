import { describe, it, expect } from "vitest";
import { getSpecialist } from "@/lib/media-intelligence/agents/registry";
import { MockProvider } from "@/lib/media-intelligence/providers/mock";
import type { MediaStrategy } from "@/lib/media-intelligence/types";

const strategy: MediaStrategy = {
  targetAudience: "a", buyerPersona: "b", emotions: [],
  highlightSpaces: [], hideSpaces: [], narrativeOrder: [],
  visualStyle: "s", recommendedPlatforms: [], recommendedDurationSec: 30,
  recommendedOutputs: [
    { capability: "video", engine: "mock", estimatedCostUsd: 0 },
    { capability: "image", engine: "mock", estimatedCostUsd: 0 },
  ],
  bestRoiCombination: [], rationale: "r",
};

describe("specialist registry", () => {
  it("returns a specialist per capability that plans + executes via a provider", async () => {
    const video = getSpecialist("video");
    expect(video.capability).toBe("video");
    const deliverables = video.plan(strategy);
    expect(deliverables.length).toBeGreaterThan(0);
    expect(deliverables[0].capability).toBe("video");
    const result = await video.execute(deliverables[0], new MockProvider());
    expect(result.status).toBe("mock");
  });
  it("provides a stub specialist for non-video capabilities", () => {
    expect(getSpecialist("voice").capability).toBe("voice");
    expect(getSpecialist("presentation").plan(strategy)).toBeInstanceOf(Array);
  });
});

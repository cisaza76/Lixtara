import { describe, it, expect } from "vitest";
import { planDeliverables } from "@/lib/media-intelligence/deliverables";
import type { MediaStrategy } from "@/lib/media-intelligence/types";

const strategy: MediaStrategy = {
  targetAudience: "a", buyerPersona: "b", emotions: [], highlightSpaces: [],
  hideSpaces: [], narrativeOrder: [], visualStyle: "s", recommendedPlatforms: [],
  recommendedDurationSec: 30,
  recommendedOutputs: [
    { capability: "video", engine: "mock", estimatedCostUsd: 0 },
    { capability: "voice", engine: "mock", estimatedCostUsd: 0 },
  ],
  bestRoiCombination: [], rationale: "r",
};

describe("planDeliverables", () => {
  it("plans deliverables for each recommended capability via its specialist", () => {
    const out = planDeliverables(strategy);
    const caps = new Set(out.map((d) => d.capability));
    expect(caps.has("video")).toBe(true);
    expect(caps.has("voice")).toBe(true);
    expect(out.every((d) => d.status === "planned")).toBe(true);
  });
});

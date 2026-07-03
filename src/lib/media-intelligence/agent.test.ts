import { describe, it, expect, vi } from "vitest";
import { runMediaAgent } from "@/lib/media-intelligence/agent";
import type { AgentDeps } from "@/lib/media-intelligence/agent";
import type { Classification, MediaStrategy, QualityScore } from "@/lib/media-intelligence/types";

function deps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  const strategy: MediaStrategy = {
    targetAudience: "a", buyerPersona: "b", emotions: [], highlightSpaces: [],
    hideSpaces: [], narrativeOrder: [], visualStyle: "s", recommendedPlatforms: [],
    recommendedDurationSec: 30,
    recommendedOutputs: [{ capability: "video", engine: "mock", estimatedCostUsd: 0 }],
    bestRoiCombination: [], rationale: "r",
  };
  const classes: Classification[] = [
    { photoId: "a", roomType: "fachada", tags: [], confidence: 1 },
    { photoId: "b", roomType: "sala", tags: [], confidence: 1 },
    { photoId: "c", roomType: "cocina", tags: [], confidence: 1 },
  ];
  const scores: QualityScore[] = classes.map((c) => ({
    photoId: c.photoId, sharpness: 0.8, lighting: 0.8, framing: 0.8, overall: 0.8,
  }));
  return {
    loadAssets: vi.fn(async () => classes.map((c) => ({ photoId: c.photoId, url: `http://x/${c.photoId}` }))),
    classify: vi.fn(async () => classes),
    score: vi.fn(async () => scores),
    strategy: vi.fn(async () => strategy),
    listingFacts: vi.fn(async () => ({ price: 1, beds: 1, baths: 1, city: "x" })),
    setStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runMediaAgent", () => {
  it("runs the pipeline and returns a completed payload", async () => {
    const d = deps();
    const payload = await runMediaAgent({ jobId: "j1", propertyId: "p1", ownerId: "o1" }, d);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.selectedShots.length).toBe(3);
    expect(payload.deliverables.length).toBeGreaterThan(0);
    expect(payload.providersUsed.video).toBe("mock");
    // status walked pending→analyzing→generating (completed handled by caller)
    expect(d.setStatus).toHaveBeenCalledWith("j1", "analyzing");
    expect(d.setStatus).toHaveBeenCalledWith("j1", "generating");
  });

  it("propagates stage errors (caller marks the job failed)", async () => {
    const d = deps({ classify: vi.fn(async () => { throw new Error("vision down"); }) });
    await expect(runMediaAgent({ jobId: "j1", propertyId: "p1", ownerId: "o1" }, d)).rejects.toThrow("vision down");
  });
});

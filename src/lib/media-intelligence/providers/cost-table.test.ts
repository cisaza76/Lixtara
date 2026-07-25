import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "@/lib/media-intelligence/providers/cost-table";

describe("estimateCostUsd", () => {
  it("returns 0 for the mock engine", () => {
    expect(estimateCostUsd("mock", "video")).toBe(0);
  });
  it("returns a positive estimate for a known live engine/capability", () => {
    expect(estimateCostUsd("veo", "video")).toBeGreaterThan(0);
  });
  it("returns 0 for an unknown engine or unsupported capability", () => {
    expect(estimateCostUsd("nope", "video")).toBe(0);
    expect(estimateCostUsd("veo", "voice")).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { BROKER_STATS } from "@/lib/broker-stats";

describe("BROKER_STATS", () => {
  // Compliance guard: salesVolume is an unverified marketing claim and must
  // stay null until the broker signs off. A non-null value here would publish
  // an unsubstantiated sales figure — fail the build instead.
  it("keeps salesVolume null until broker sign-off", () => {
    expect(BROKER_STATS.salesVolume).toBeNull();
  });

  it("carries the factual brokerage claims", () => {
    expect(BROKER_STATS.yearsExperience).toBe(20);
    expect(BROKER_STATS.mlsCoverage).toBe("100%");
  });
});

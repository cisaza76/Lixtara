import { describe, it, expect } from "vitest";
import {
  STAGING_STYLES,
  STAGING_PROMPTS,
  promptFor,
  isStagingStyle,
} from "@/lib/staging";

describe("staging styles", () => {
  it("exposes the 4 canonical style ids", () => {
    expect(STAGING_STYLES).toEqual(["modern", "minimalist", "traditional", "warm"]);
  });

  it("has a prompt for each style", () => {
    for (const s of STAGING_STYLES) {
      expect(promptFor(s).length).toBeGreaterThan(100);
    }
  });

  it("every prompt carries the architecture-preservation guard + no-people clause", () => {
    for (const p of Object.values(STAGING_PROMPTS)) {
      // These two constraints are the difference between a usable staged
      // photo and one that gets us in trouble with MLS rules.
      expect(p).toMatch(/Do not alter walls, windows, doors/);
      expect(p).toMatch(/No people/);
    }
  });

  it("isStagingStyle accepts the 4 known styles and rejects everything else", () => {
    expect(isStagingStyle("modern")).toBe(true);
    expect(isStagingStyle("warm")).toBe(true);
    expect(isStagingStyle("industrial")).toBe(false);
    expect(isStagingStyle("")).toBe(false);
    expect(isStagingStyle("MODERN")).toBe(false); // case-sensitive
  });
});

import { describe, it, expect } from "vitest";
import {
  QUIZ_PHOTO_OPTIONS,
  QUIZ_VALUE_OPTIONS,
  parseQuizPhoto,
  parseQuizValue,
  recommendTier,
} from "@/lib/plan-quiz";

describe("recommendTier", () => {
  it("returns null until both questions are answered", () => {
    expect(recommendTier(null, "pro")).toBeNull();
    expect(recommendTier("mid", null)).toBeNull();
  });

  it("recommends Essentials for phone photos or photos the seller already has, at any value", () => {
    for (const value of QUIZ_VALUE_OPTIONS) {
      expect(recommendTier(value, "self")).toBe("essentials");
      expect(recommendTier(value, "own")).toBe("essentials");
    }
  });

  it("recommends Pro for professional photos under $700K and Concierge above", () => {
    expect(recommendTier("under", "pro")).toBe("pro");
    expect(recommendTier("mid", "pro")).toBe("pro");
    expect(recommendTier("over", "pro")).toBe("concierge");
  });
});

describe("quiz param parsing", () => {
  it("accepts only the known options", () => {
    expect(parseQuizValue("mid")).toBe("mid");
    expect(parseQuizValue("huge")).toBeNull();
    expect(parseQuizValue(undefined)).toBeNull();
    expect(parseQuizPhoto("own")).toBe("own");
    // The retired "white" (full white-glove) option no longer exists.
    expect(parseQuizPhoto("white")).toBeNull();
  });

  it("offers exactly three photo options", () => {
    expect([...QUIZ_PHOTO_OPTIONS]).toEqual(["self", "pro", "own"]);
  });
});

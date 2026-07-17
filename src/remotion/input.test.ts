import { describe, it, expect } from "vitest";
import { perPhotoDurationFrames, totalDurationFrames, listingVideoInputSchema } from "./input";

const valid = {
  property: { addressLine: "123 Main St, Doral FL" },
  priceLabel: "$450,000",
  photos: [{ url: "u" }],
  brand: { name: "Lixtara" },
  cta: { text: "See more at lixtara.com" },
  badge: null,
};

describe("perPhotoDurationFrames", () => {
  it("splits photo time across photos in whole frames", () => {
    expect(perPhotoDurationFrames(5, 30, 4)).toBe(120); // 4s*30 = 120 frames each
  });
  it("never returns zero", () => {
    expect(perPhotoDurationFrames(1, 30, 3)).toBe(90);
  });
});

describe("totalDurationFrames", () => {
  it("includes opening + photos + closing", () => {
    // opening 2s + 3 photos*4s + closing 2s = 16s * 30 = 480
    expect(totalDurationFrames(3, 30, { photoSeconds: 4, openingSeconds: 2, closingSeconds: 2 })).toBe(480);
  });
});

describe("listingVideoInputSchema", () => {
  it("accepts a valid input and rejects an empty photo list", () => {
    expect(listingVideoInputSchema.safeParse(valid).success).toBe(true);
    expect(listingVideoInputSchema.safeParse({ ...valid, photos: [] }).success).toBe(false);
  });
  it("accepts an optional badge in the reserved slot", () => {
    expect(listingVideoInputSchema.safeParse({ ...valid, badge: { text: "Price Reduced" } }).success).toBe(true);
  });
});

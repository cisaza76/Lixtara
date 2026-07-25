import { describe, it, expect } from "vitest";
import { perPhotoDurationFrames, photoSectionFrames, totalDurationFrames, listingVideoInputSchema } from "./input";
import { CROSSFADE_FRAMES } from "./layout";

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

describe("photoSectionFrames — overlapping crossfades", () => {
  it("a single photo has no overlap", () => {
    expect(photoSectionFrames(1, 120)).toBe(120);
  });
  it("N photos overlap by CROSSFADE_FRAMES each, shortening the gallery by (N-1)*CROSSFADE_FRAMES", () => {
    // 3 * 120 - 2 * 20 = 320  (v1 back-to-back would have been 360)
    expect(photoSectionFrames(3, 120)).toBe(3 * 120 - 2 * CROSSFADE_FRAMES);
    expect(photoSectionFrames(10, 120)).toBe(10 * 120 - 9 * CROSSFADE_FRAMES);
  });
  it("zero photos → zero", () => {
    expect(photoSectionFrames(0, 120)).toBe(0);
  });
});

describe("totalDurationFrames", () => {
  it("includes opening + overlapping gallery + closing", () => {
    // opening 60 + gallery(3*120 - 2*20 = 320) + closing 60 = 440
    expect(totalDurationFrames(3, 30, { photoSeconds: 4, openingSeconds: 2, closingSeconds: 2 })).toBe(440);
  });
  it("a single photo is unaffected by overlap (opening 60 + 120 + closing 60 = 240)", () => {
    expect(totalDurationFrames(1, 30, { photoSeconds: 4, openingSeconds: 2, closingSeconds: 2 })).toBe(240);
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

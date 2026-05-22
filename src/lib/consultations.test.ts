import { describe, it, expect } from "vitest";
import {
  ATTORNEY_HOURLY,
  REALTOR_HOURLY,
  TOKEN_VALIDITY_DAYS,
  REALTOR_TIERS,
  BEST_VALUE,
  bestValueTotals,
} from "@/lib/consultations";

describe("consultation pricing", () => {
  it("holds the canonical hourly rates + validity", () => {
    expect(ATTORNEY_HOURLY).toBe(450);
    expect(REALTOR_HOURLY).toBe(150);
    expect(TOKEN_VALIDITY_DAYS).toBe(90);
  });

  it("has the realtor hourly tiers with the right discounts", () => {
    expect(REALTOR_TIERS).toEqual([
      { hours: 1, price: 150, savePct: 0 },
      { hours: 5, price: 675, savePct: 10 },
      { hours: 10, price: 1200, savePct: 20 },
    ]);
  });

  it("computes the Best Value package: $2,700 value, save $1,250 (46% off)", () => {
    expect(BEST_VALUE.price).toBe(1450);
    expect(bestValueTotals()).toEqual({
      totalValue: 2700,
      save: 1250,
      savePct: 46,
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  PRICING_TIERS,
  TIER_ORDER,
  DEFAULT_TIER,
  TRADITIONAL_COSTS,
  getTier,
  tierTotalCost,
  tierSavingsVsTraditional,
} from "@/lib/pricing-tiers";

describe("PRICING_TIERS catalog", () => {
  it("holds the canonical flat fees (CLAUDE.md: 199 / 495 / 995)", () => {
    expect(PRICING_TIERS.essentials.flatFee).toBe(199);
    expect(PRICING_TIERS.pro.flatFee).toBe(495);
    expect(PRICING_TIERS.concierge.flatFee).toBe(995);
  });

  it("holds the canonical commission percentages", () => {
    expect(PRICING_TIERS.essentials.commissionPct).toBe(0.5);
    expect(PRICING_TIERS.pro.commissionPct).toBe(1);
    expect(PRICING_TIERS.concierge.commissionPct).toBe(1.5);
  });

  it("uses a 24-month term for every tier", () => {
    for (const id of TIER_ORDER) {
      expect(PRICING_TIERS[id].termMonths).toBe(24);
    }
  });

  it("includes professional photography only on pro + concierge (essentials is DIY)", () => {
    expect(PRICING_TIERS.essentials.includesPhotography).toBe(false);
    expect(PRICING_TIERS.pro.includesPhotography).toBe(true);
    expect(PRICING_TIERS.concierge.includesPhotography).toBe(true);
  });

  it("orders tiers cheapest → priciest", () => {
    const fees = TIER_ORDER.map((id) => PRICING_TIERS[id].flatFee);
    expect(fees).toEqual([...fees].sort((a, b) => a - b));
  });
});

describe("TRADITIONAL_COSTS (Radical Transparency comparison baseline)", () => {
  it("holds the canonical traditional-agent comparison values", () => {
    expect(TRADITIONAL_COSTS.listingCommissionPct).toBe(3);
    expect(TRADITIONAL_COSTS.buyerCommissionPct).toBe(3);
    expect(TRADITIONAL_COSTS.photography).toBe(300);
    expect(TRADITIONAL_COSTS.docContracts).toBe(40);
  });
});

describe("getTier", () => {
  it("returns the requested tier when valid", () => {
    expect(getTier("concierge").id).toBe("concierge");
  });

  it("falls back to the default tier for unknown / null / undefined input", () => {
    expect(getTier("garbage").id).toBe(DEFAULT_TIER);
    expect(getTier(null).id).toBe(DEFAULT_TIER);
    expect(getTier(undefined).id).toBe(DEFAULT_TIER);
  });
});

describe("tierTotalCost", () => {
  it("adds the seller-side commission for essentials (0.5%)", () => {
    expect(tierTotalCost("essentials", 500_000)).toBe(199 + 2_500);
  });

  it("adds the seller-side commission for pro (1%)", () => {
    expect(tierTotalCost("pro", 500_000)).toBe(495 + 5_000);
  });

  it("adds the seller-side commission for concierge (1.5%)", () => {
    expect(tierTotalCost("concierge", 500_000)).toBe(995 + 7_500);
  });
});

describe("tierSavingsVsTraditional", () => {
  it("compares total cost against a 6% traditional commission", () => {
    // traditional = 30_000; pro total = 495 + 5_000 = 5_495
    expect(tierSavingsVsTraditional("pro", 500_000)).toBe(30_000 - 5_495);
  });

  it("never goes negative (tiny sale where the flat fee dwarfs 6%)", () => {
    // 6% of 1_000 = 60, below the essentials flat fee + commission
    expect(tierSavingsVsTraditional("essentials", 1_000)).toBe(0);
  });
});

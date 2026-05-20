import { describe, it, expect } from "vitest";
import {
  calculateRebate,
  LIXTARA_BUYER_FEE_PCT,
  REBATE_CAP,
  TYPICAL_BUYER_AGENT_PCT,
} from "@/lib/buyer-rebate";

describe("buyer-rebate constants", () => {
  it("match the canonical economics (CLAUDE.md invariants)", () => {
    expect(LIXTARA_BUYER_FEE_PCT).toBe(0.5);
    expect(REBATE_CAP).toBe(50_000);
    expect(TYPICAL_BUYER_AGENT_PCT).toBe(2.5);
  });
});

describe("calculateRebate", () => {
  it("computes commission, fee, and rebate for a typical sale", () => {
    const r = calculateRebate(500_000, 2.5);
    expect(r.commissionEarned).toBe(12_500);
    expect(r.lixtaraFee).toBe(2_500);
    expect(r.rebate).toBe(10_000);
    expect(r.cappedAtMax).toBe(false);
  });

  it("defaults the offered commission to the typical buyer-agent pct", () => {
    expect(calculateRebate(500_000)).toEqual(
      calculateRebate(500_000, TYPICAL_BUYER_AGENT_PCT),
    );
  });

  it("caps the rebate at REBATE_CAP and flags it when uncapped exceeds the cap", () => {
    const r = calculateRebate(3_000_000, 2.5); // uncapped would be 60k
    expect(r.rebate).toBe(REBATE_CAP);
    expect(r.cappedAtMax).toBe(true);
  });

  it("does not flag cappedAtMax when uncapped exactly equals the cap", () => {
    // uncapped = price * (2.5 - 0.5)/100 = price * 0.02 = 50_000 → price 2.5M
    const r = calculateRebate(2_500_000, 2.5);
    expect(r.rebate).toBe(REBATE_CAP);
    expect(r.cappedAtMax).toBe(false); // strictly-greater is the flag condition
  });

  it("never returns a negative rebate when the fee exceeds the commission", () => {
    const r = calculateRebate(400_000, 0.25); // commission 1_000 < fee 2_000
    expect(r.rebate).toBe(0);
    expect(r.cappedAtMax).toBe(false);
  });

  it("returns zeros for a zero purchase price", () => {
    expect(calculateRebate(0)).toEqual({
      commissionEarned: 0,
      lixtaraFee: 0,
      rebate: 0,
      cappedAtMax: false,
    });
  });
});

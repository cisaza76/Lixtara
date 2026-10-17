import { describe, it, expect } from "vitest";
import {
  CONSULTATION_PRODUCTS,
  REALTOR_HOURLY,
  TOKEN_VALIDITY_DAYS,
  REALTOR_TIERS,
  isConsultationProduct,
} from "@/lib/consultations";

describe("consultation pricing", () => {
  it("holds the canonical hourly rate + validity", () => {
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

  it("Lixtara no vende servicios legales: solo productos de Realtor, sin horas de abogado", () => {
    expect(Object.keys(CONSULTATION_PRODUCTS).sort()).toEqual(["realtor_1", "realtor_10", "realtor_5"]);
    for (const p of Object.values(CONSULTATION_PRODUCTS)) {
      expect(p).not.toHaveProperty("attorneyHours");
      expect(p.name).not.toMatch(/attorney|abogad/i);
    }
    for (const retired of ["attorney_1", "best_value", "toString", "__proto__"]) {
      expect(isConsultationProduct(retired), retired).toBe(false);
    }
  });
});

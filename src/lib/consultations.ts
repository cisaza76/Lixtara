// Single source for expert-consultation pricing. UI reads from here — never
// hardcode these amounts in components.

export const ATTORNEY_HOURLY = 450; // USD/hr
export const REALTOR_HOURLY = 150; // USD/hr
export const TOKEN_VALIDITY_DAYS = 90;

export interface RealtorTier {
  hours: number;
  price: number;
  savePct: number;
}

export const REALTOR_TIERS: RealtorTier[] = [
  { hours: 1, price: 150, savePct: 0 },
  { hours: 5, price: 675, savePct: 10 },
  { hours: 10, price: 1200, savePct: 20 },
];

export const BEST_VALUE = {
  price: 1450,
  realtorHours: 15,
  attorneyHours: 1,
};

// Purchasable products → Stripe amount (USD) + the hour tokens they grant.
export type ConsultationProduct =
  | "best_value"
  | "realtor_1"
  | "realtor_5"
  | "realtor_10"
  | "attorney_1";

export const CONSULTATION_PRODUCTS: Record<
  ConsultationProduct,
  { amount: number; realtorHours: number; attorneyHours: number; name: string }
> = {
  best_value: {
    amount: BEST_VALUE.price,
    realtorHours: BEST_VALUE.realtorHours,
    attorneyHours: BEST_VALUE.attorneyHours,
    name: "Best Value Package (15h Realtor + 1h Attorney)",
  },
  realtor_1: { amount: 150, realtorHours: 1, attorneyHours: 0, name: "Realtor consultation — 1 hour" },
  realtor_5: { amount: 675, realtorHours: 5, attorneyHours: 0, name: "Realtor consultation — 5 hours" },
  realtor_10: { amount: 1200, realtorHours: 10, attorneyHours: 0, name: "Realtor consultation — 10 hours" },
  attorney_1: { amount: 450, realtorHours: 0, attorneyHours: 1, name: "Attorney consultation — 1 hour" },
};

export function isConsultationProduct(v: string): v is ConsultationProduct {
  return v in CONSULTATION_PRODUCTS;
}

/** Best Value package value/savings, derived from the hourly rates. */
export function bestValueTotals(): {
  totalValue: number;
  save: number;
  savePct: number;
} {
  const totalValue =
    BEST_VALUE.realtorHours * REALTOR_HOURLY +
    BEST_VALUE.attorneyHours * ATTORNEY_HOURLY;
  const save = totalValue - BEST_VALUE.price;
  const savePct = Math.round((save / totalValue) * 100);
  return { totalValue, save, savePct };
}

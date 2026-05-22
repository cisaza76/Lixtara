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

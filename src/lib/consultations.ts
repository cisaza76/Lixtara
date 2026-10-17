// Single source for expert-consultation pricing. UI reads from here — never
// hardcode these amounts in components.
//
// Solo consultas con un Realtor (servicio de corretaje). Lixtara NO vende, cobra ni incluye
// servicios legales (decisión del owner 2026-10-16; Florida Bar 4-5.4 y 4-5.5): las horas de
// abogado ($450/h) y el paquete "Best Value" (15 h Realtor + 1 h abogado) se retiraron. Para
// un abogado, Lixtara solo refiere a una firma independiente (src/config/legalPartner.ts).

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

// Purchasable products → Stripe amount (USD) + the Realtor hour tokens they grant.
export type ConsultationProduct = "realtor_1" | "realtor_5" | "realtor_10";

export const CONSULTATION_PRODUCTS: Record<
  ConsultationProduct,
  { amount: number; realtorHours: number; name: string }
> = {
  realtor_1: { amount: 150, realtorHours: 1, name: "Realtor consultation (1 hour)" },
  realtor_5: { amount: 675, realtorHours: 5, name: "Realtor consultation (5 hours)" },
  realtor_10: { amount: 1200, realtorHours: 10, name: "Realtor consultation (10 hours)" },
};

export function isConsultationProduct(v: string): v is ConsultationProduct {
  return Object.prototype.hasOwnProperty.call(CONSULTATION_PRODUCTS, v);
}

// Central catalog of Lixtara pricing tiers. UI, calculator, listing flow,
// and Stripe checkout (F2+) all read from this single source of truth.
// NEVER hardcode flat-fee dollar amounts or commission percentages elsewhere.

export type PricingTierId = "essentials" | "pro" | "concierge";

export interface PricingTier {
  id: PricingTierId;
  /** flat one-time fee in USD */
  flatFee: number;
  /** seller-side commission as percent of sale price */
  commissionPct: number;
  termMonths: number;
}

export const PRICING_TIERS: Record<PricingTierId, PricingTier> = {
  essentials: { id: "essentials", flatFee: 199, commissionPct: 0, termMonths: 24 },
  pro: { id: "pro", flatFee: 495, commissionPct: 0.5, termMonths: 24 },
  concierge: { id: "concierge", flatFee: 995, commissionPct: 1, termMonths: 24 },
};

export const TIER_ORDER: PricingTierId[] = ["essentials", "pro", "concierge"];

export const DEFAULT_TIER: PricingTierId = "pro";

export function getTier(
  id: PricingTierId | string | null | undefined,
): PricingTier {
  if (id && id in PRICING_TIERS) return PRICING_TIERS[id as PricingTierId];
  return PRICING_TIERS[DEFAULT_TIER];
}

export function tierTotalCost(
  tierId: PricingTierId,
  salePrice: number,
): number {
  const t = PRICING_TIERS[tierId];
  return t.flatFee + (salePrice * t.commissionPct) / 100;
}

export function tierSavingsVsTraditional(
  tierId: PricingTierId,
  salePrice: number,
): number {
  const traditional = salePrice * 0.06;
  return Math.max(0, traditional - tierTotalCost(tierId, salePrice));
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

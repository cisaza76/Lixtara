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
  /** true = professional photographer included; false = DIY smartphone guide */
  includesPhotography: boolean;
}

export const PRICING_TIERS: Record<PricingTierId, PricingTier> = {
  essentials: { id: "essentials", flatFee: 199, commissionPct: 0, termMonths: 24, includesPhotography: false },
  pro: { id: "pro", flatFee: 495, commissionPct: 0.5, termMonths: 24, includesPhotography: true },
  concierge: { id: "concierge", flatFee: 995, commissionPct: 1, termMonths: 24, includesPhotography: true },
};

// Baseline costs of the traditional-agent comparison, in USD (flat) or percent.
// Single source for the Radical Transparency table — never hardcode in the UI.
export const TRADITIONAL_COSTS = {
  /** listing-side commission a traditional agent charges (the part Lixtara replaces) */
  listingCommissionPct: 3,
  /** typical buyer-agent commission in the traditional 6% model */
  buyerCommissionPct: 3,
  /** typical out-of-pocket photography fee */
  photography: 300,
  /** typical document / e-signature fee */
  docContracts: 40,
} as const;

// Standalone professional-photography add-on (USD). Included in Pro/Concierge;
// sellers on Essentials can purchase it separately. Single source of truth.
export const PHOTOGRAPHY_ADDON_PRICE = 495;

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

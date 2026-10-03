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
  essentials: { id: "essentials", flatFee: 199, commissionPct: 0.5, termMonths: 24, includesPhotography: false },
  pro: { id: "pro", flatFee: 495, commissionPct: 1, termMonths: 24, includesPhotography: true },
  concierge: { id: "concierge", flatFee: 995, commissionPct: 1.5, termMonths: 24, includesPhotography: true },
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

// Sale price used in illustrative copy (e.g. the FAQ cost comparison).
export const EXAMPLE_SALE_PRICE = 500_000;

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
  const traditional =
    (salePrice *
      (TRADITIONAL_COSTS.listingCommissionPct +
        TRADITIONAL_COSTS.buyerCommissionPct)) /
    100;
  return Math.max(0, traditional - tierTotalCost(tierId, salePrice));
}

export interface TierCostBreakdown {
  /** due at listing — the Lixtara flat fee only */
  upfront: number;
  /** Lixtara listing-side commission, paid from proceeds only if the home sells */
  sellerCommission: number;
  /** buyer-agent commission the seller offers, paid from proceeds at closing */
  buyerCommission: number;
  /** sellerCommission + buyerCommission */
  closing: number;
  total: number;
}

// Cost of selling with a Lixtara tier, split by WHEN it is paid. Only the flat
// fee is charged upfront (Stripe checkout); every commission comes out of the
// sale proceeds at closing, so it is owed only if the property sells.
export function tierCostBreakdown(
  tierId: PricingTierId,
  salePrice: number,
  buyerCommissionPct: number,
): TierCostBreakdown {
  const t = PRICING_TIERS[tierId];
  const sellerCommission = (salePrice * t.commissionPct) / 100;
  const buyerCommission = (salePrice * buyerCommissionPct) / 100;
  const closing = sellerCommission + buyerCommission;
  return {
    upfront: t.flatFee,
    sellerCommission,
    buyerCommission,
    closing,
    total: t.flatFee + closing,
  };
}

// Fills tier placeholders in copy strings so dictionaries never hardcode
// prices: {commissionPct}, {flatFee}, {termMonths}.
export function fillTierCopy(text: string, tierId: PricingTierId): string {
  const t = PRICING_TIERS[tierId];
  return fillPricingCopy(
    text
      .replaceAll("{commissionPct}", String(t.commissionPct))
      .replaceAll("{flatFee}", String(t.flatFee))
      .replaceAll("{termMonths}", String(t.termMonths)),
  );
}

// Fills catalog-wide placeholders so dictionaries never hardcode amounts:
//   {photoAddonPrice}       → "$495"   (PHOTOGRAPHY_ADDON_PRICE)
//   {proFlatFee}            → "$495"   {proCommissionPct} → "1"
//   {exampleSalePrice}      → "$500,000"
//   {traditionalExample}    → 6% (listing + buyer) of the example price
//   {proTotalExample}       → Pro flat fee + Pro commission on the example price
export function fillPricingCopy(text: string): string {
  const traditionalPct =
    TRADITIONAL_COSTS.listingCommissionPct + TRADITIONAL_COSTS.buyerCommissionPct;
  return text
    .replaceAll("{photoAddonPrice}", formatPrice(PHOTOGRAPHY_ADDON_PRICE))
    .replaceAll("{proFlatFee}", formatPrice(PRICING_TIERS.pro.flatFee))
    .replaceAll("{proCommissionPct}", String(PRICING_TIERS.pro.commissionPct))
    .replaceAll("{exampleSalePrice}", formatPrice(EXAMPLE_SALE_PRICE))
    .replaceAll(
      "{traditionalExample}",
      formatPrice((EXAMPLE_SALE_PRICE * traditionalPct) / 100),
    )
    .replaceAll(
      "{proTotalExample}",
      formatPrice(tierTotalCost("pro", EXAMPLE_SALE_PRICE)),
    );
}

// Fills the per-tier commission placeholders used in comparison copy:
// {essentials}, {pro}, {concierge} → that tier's commission %, and
// {traditional} → the traditional listing-side commission %.
export function fillCommissionCopy(text: string): string {
  return text
    .replaceAll("{essentials}", String(PRICING_TIERS.essentials.commissionPct))
    .replaceAll("{pro}", String(PRICING_TIERS.pro.commissionPct))
    .replaceAll("{concierge}", String(PRICING_TIERS.concierge.commissionPct))
    .replaceAll(
      "{traditional}",
      String(TRADITIONAL_COSTS.listingCommissionPct),
    );
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

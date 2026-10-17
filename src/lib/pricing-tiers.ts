// Central catalog of Lixtara pricing tiers. UI, calculator, listing flow,
// and Stripe checkout (F2+) all read from this single source of truth.
// NEVER hardcode flat-fee dollar amounts or commission percentages elsewhere.

import { PUBLICATION_BUSINESS_DAYS } from "@/config/publication";

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

// Baseline of the traditional-agent comparison. Single source — never hardcode in the UI.
// Only the LISTING side differs between a traditional agent and Lixtara: the buyer-agent
// compensation is the seller's choice either way, so every comparison puts the SAME
// buyer-agent % on both sides (compareWithTraditional). Photos and documents are not
// added to the traditional side: a traditional listing agent normally includes them.
export const TRADITIONAL_COSTS = {
  /** listing-side commission a traditional agent charges (the part Lixtara replaces) */
  listingCommissionPct: 3,
  /** typical buyer-agent commission; only for the "typical 6%" wording, never in a calculation */
  typicalBuyerCommissionPct: 3,
} as const;

/** "Typical 6%" = listing side + typical buyer side, for copy only. */
export const TRADITIONAL_TYPICAL_TOTAL_PCT =
  TRADITIONAL_COSTS.listingCommissionPct + TRADITIONAL_COSTS.typicalBuyerCommissionPct;

/** Buyer-agent % used where the seller hasn't chosen one (FAQ, Loui, the calculator's start). */
export const DEFAULT_BUYER_COMMISSION_PCT = 2.5;

// Standalone professional-photography add-on (USD). Included in Pro/Concierge;
// sellers on Essentials can purchase it separately. Single source of truth.
export const PHOTOGRAPHY_ADDON_PRICE = 495;

export const TIER_ORDER: PricingTierId[] = ["essentials", "pro", "concierge"];

export const DEFAULT_TIER: PricingTierId = "pro";

/** Narrowing de un string externo (p. ej. metadata de Stripe) a un tier conocido. */
export function isPricingTierId(v: unknown): v is PricingTierId {
  return typeof v === "string" && (TIER_ORDER as string[]).includes(v);
}

// Home-value buckets for the "Find your plan" quiz (USD). The quiz only
// RECOMMENDS a plan — the seller can still pick any plan on the listing form.
// A seller who wants professional photos and whose home is worth more than
// `conciergeMin` is pointed to Concierge; below it, to Pro.
export const QUIZ_HOME_VALUE_THRESHOLDS = {
  /** lower bound of the middle bucket */
  midMin: 300_000,
  /** above this, the quiz recommends Concierge (for pro-photo sellers) */
  conciergeMin: 700_000,
} as const;

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

export interface TraditionalComparison {
  /** buyer-agent % used on BOTH sides */
  buyerCommissionPct: number;
  traditional: { listingCommission: number; buyerCommission: number; total: number };
  lixtara: TierCostBreakdown;
  /** traditional.total − lixtara.total: only the listing-side difference */
  savings: number;
}

// THE comparison against a traditional agent (calculator, FAQ, Loui, step 6). Same
// buyer-agent compensation on both sides, so the savings reflect only the listing side:
// traditional listing % − Lixtara %, minus the flat fee.
export function compareWithTraditional(
  tierId: PricingTierId,
  salePrice: number,
  buyerCommissionPct: number = DEFAULT_BUYER_COMMISSION_PCT,
): TraditionalComparison {
  const lixtara = tierCostBreakdown(tierId, salePrice, buyerCommissionPct);
  const listingCommission = (salePrice * TRADITIONAL_COSTS.listingCommissionPct) / 100;
  // The very same buyer-agent amount Lixtara's side carries.
  const buyerCommission = lixtara.buyerCommission;
  const traditionalTotal = listingCommission + buyerCommission;
  return {
    buyerCommissionPct,
    traditional: { listingCommission, buyerCommission, total: traditionalTotal },
    lixtara,
    savings: traditionalTotal - lixtara.total,
  };
}

/** Savings vs a traditional agent with the same buyer-agent %; never below 0. */
export function tierSavingsVsTraditional(
  tierId: PricingTierId,
  salePrice: number,
  buyerCommissionPct: number = DEFAULT_BUYER_COMMISSION_PCT,
): number {
  return Math.max(0, compareWithTraditional(tierId, salePrice, buyerCommissionPct).savings);
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

function formatThousands(amount: number): string {
  return `$${amount / 1000}K`;
}

// Fills catalog-wide placeholders so dictionaries never hardcode amounts:
//   {photoAddonPrice}       → "$495"   (PHOTOGRAPHY_ADDON_PRICE)
//   {publicationBusinessDays} → "2"    (src/config/publication.ts)
//   {proFlatFee}            → "$495"   {proCommissionPct} → "1"
//   {exampleSalePrice}      → "$500,000"
//   {exampleBuyerPct}       → "2.5" (DEFAULT_BUYER_COMMISSION_PCT)
//   {traditionalListingPct} → "3"   {traditionalBuyerPct} → "3"   {traditionalTypicalPct} → "6"
//   {traditionalExample}    → traditional total on the example price, same buyer-agent % as Lixtara
//   {proTotalExample}       → Pro total on the example price (fee + Pro % + buyer-agent %)
//   {proSavingsExample}     → the difference (compareWithTraditional)
//   {quizMidMin} / {quizConciergeMin} → "$300K" / "$700K"
export function fillPricingCopy(text: string): string {
  const example = compareWithTraditional("pro", EXAMPLE_SALE_PRICE, DEFAULT_BUYER_COMMISSION_PCT);
  return text
    .replaceAll("{photoAddonPrice}", formatPrice(PHOTOGRAPHY_ADDON_PRICE))
    .replaceAll("{publicationBusinessDays}", String(PUBLICATION_BUSINESS_DAYS))
    .replaceAll("{proFlatFee}", formatPrice(PRICING_TIERS.pro.flatFee))
    .replaceAll("{proCommissionPct}", String(PRICING_TIERS.pro.commissionPct))
    .replaceAll("{exampleSalePrice}", formatPrice(EXAMPLE_SALE_PRICE))
    .replaceAll("{exampleBuyerPct}", String(DEFAULT_BUYER_COMMISSION_PCT))
    .replaceAll("{traditionalListingPct}", String(TRADITIONAL_COSTS.listingCommissionPct))
    .replaceAll("{traditionalBuyerPct}", String(TRADITIONAL_COSTS.typicalBuyerCommissionPct))
    .replaceAll("{traditionalTypicalPct}", String(TRADITIONAL_TYPICAL_TOTAL_PCT))
    .replaceAll("{traditionalExample}", formatPrice(example.traditional.total))
    .replaceAll("{proTotalExample}", formatPrice(example.lixtara.total))
    .replaceAll("{proSavingsExample}", formatPrice(example.savings))
    .replaceAll("{quizMidMin}", formatThousands(QUIZ_HOME_VALUE_THRESHOLDS.midMin))
    .replaceAll(
      "{quizConciergeMin}",
      formatThousands(QUIZ_HOME_VALUE_THRESHOLDS.conciergeMin),
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

"use client";

// Radical Transparency calculator — full per-tier cost breakdown:
//   - Home value slider + buyer-agent commission selector (2 / 2.5 / 3 %)
//   - UPFRONT costs: listing fee, professional photos, DocuSign contracts,
//     subtotal. On Lixtara this is ONLY the flat fee (what Stripe charges).
//   - CLOSING costs: your (listing-side) commission + buyer-agent commission,
//     subtotal — paid from sale proceeds, so only if the home sells
//   - Total cost + you-save-vs-traditional + a dynamic key-insight callout
//
// The buyer-agent commission applies to BOTH columns (you offer it either way),
// so the savings reflect only what Lixtara replaces on the seller side. All
// dollar inputs come from pricing-tiers.ts (TRADITIONAL_COSTS / PRICING_TIERS) —
// never hardcode amounts here.

import { useState } from "react";
import {
  PRICING_TIERS,
  TIER_ORDER,
  TRADITIONAL_COSTS,
  fillCommissionCopy,
  tierCostBreakdown,
} from "@/lib/pricing-tiers";
import { InfoTip } from "@/components/info-tip";

interface SavingsCopy {
  priceLabel: string;
  buyerCommissionLabel: string;
  buyerCommissionHint: string;
  youSelected: string;
  upfrontHeader: string;
  closingHeader: string;
  upfrontLegend: string;
  lineListingFee: string;
  lineSellerCommission: string;
  linePhotos: string;
  lineDocusign: string;
  lineUpfrontSubtotal: string;
  lineBuyerCommission: string;
  lineClosingSubtotal: string;
  lineTotal: string;
  lineSavings: string;
  traditionalLabel: string;
  photoDiy: string;
  included: string;
  keyInsightLabel: string;
  keyInsight: string;
  howToRead: string;
  howToReadBody: string;
  infoAriaLabel: string;
  tipListingFee: string;
  tipSellerCommission: string;
  tipPhotos: string;
  tipDocusign: string;
  tipUpfrontSubtotal: string;
  tipBuyerCommission: string;
  tipClosingSubtotal: string;
  tipTotal: string;
  tipSavings: string;
}

interface SavingsSliderProps {
  copy: SavingsCopy;
  tierNames: Record<"essentials" | "pro" | "concierge", string>;
}

interface Column {
  key: string;
  label: string;
  isTraditional: boolean;
  listingFee: number;
  sellerComm: number;
  sellerPct: number;
  /** dollar amount for traditional; null for tiers (show text instead) */
  photos: number | null;
  photosText: string;
  docusign: number | null;
  upfront: number;
  buyer: number;
  closing: number;
  /** the buyer-agent % shown for this column (traditional is fixed; tiers follow the slider) */
  buyerPctShown: number;
  total: number;
  savings: number;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsSlider({ copy, tierNames }: SavingsSliderProps) {
  const [price, setPrice] = useState(500_000);
  const [buyerPct, setBuyerPct] = useState(3);

  // Traditional buyer-agent commission is the FIXED 3% benchmark — it must NOT
  // move with the slider. The slider only changes what YOU offer on Lixtara;
  // the traditional column stays put so the comparison is a stable comparable.
  const tradBuyerComm = price * (TRADITIONAL_COSTS.buyerCommissionPct / 100);

  const tradSellerComm = price * (TRADITIONAL_COSTS.listingCommissionPct / 100);
  // A traditional agent's commission is also paid from proceeds at closing;
  // only photo + document fees are out of pocket at listing.
  const tradUpfront = TRADITIONAL_COSTS.photography + TRADITIONAL_COSTS.docContracts;
  const tradClosing = tradSellerComm + tradBuyerComm;
  const tradTotal = tradUpfront + tradClosing;

  const columns: Column[] = [
    {
      key: "traditional",
      label: copy.traditionalLabel,
      isTraditional: true,
      listingFee: 0,
      sellerComm: tradSellerComm,
      sellerPct: TRADITIONAL_COSTS.listingCommissionPct,
      photos: TRADITIONAL_COSTS.photography,
      photosText: "",
      docusign: TRADITIONAL_COSTS.docContracts,
      upfront: tradUpfront,
      buyer: tradBuyerComm,
      closing: tradClosing,
      buyerPctShown: TRADITIONAL_COSTS.buyerCommissionPct,
      total: tradTotal,
      savings: 0,
    },
    ...TIER_ORDER.map((id): Column => {
      const tier = PRICING_TIERS[id];
      // photos + docusign are $0 on Lixtara, so upfront is the flat fee only
      const cost = tierCostBreakdown(id, price, buyerPct);
      return {
        key: id,
        label: tierNames[id],
        isTraditional: false,
        listingFee: tier.flatFee,
        sellerComm: cost.sellerCommission,
        sellerPct: tier.commissionPct,
        photos: null,
        photosText: tier.includesPhotography ? copy.included : copy.photoDiy,
        docusign: null,
        upfront: cost.upfront,
        buyer: cost.buyerCommission,
        closing: cost.closing,
        buyerPctShown: buyerPct,
        total: cost.total,
        savings: tradTotal - cost.total,
      };
    }),
  ];

  const bestTier = columns
    .filter((c) => !c.isTraditional)
    .reduce((best, c) => (c.savings > best.savings ? c : best));
  const keyInsightText = copy.keyInsight
    .replace("{tier}", bestTier.label)
    .replace("{pct}", `${buyerPct}%`)
    .replace("{amount}", usd(bestTier.savings));

  const headerCell =
    "p-3 text-right text-[10px] uppercase tracking-[0.18em] font-semibold";
  const labelCell = "p-3 text-ink/70 text-xs";
  const moneyCell = "p-3 text-right text-ink text-sm";
  const sectionRow =
    "p-3 text-[10px] uppercase tracking-[0.22em] text-gold font-semibold bg-ivory-strong/50";
  const pctTag = "text-[10px] text-ink/55 ml-1";

  return (
    <div className="flex flex-col gap-10">
      {/* Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {copy.priceLabel}
            </span>
            <span className="font-display italic text-3xl text-ink leading-none">
              <span className="text-gold text-lg align-top">$</span>
              {(price / 1000).toLocaleString("en-US")}
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55 font-sans not-italic ml-1">
                K
              </span>
            </span>
          </div>
          <input
            type="range"
            aria-label="Sale price"
            aria-valuetext={`$${price.toLocaleString("en-US")}`}
            min={200_000}
            max={2_000_000}
            step={25_000}
            value={price}
            onChange={(e) => setPrice(Number.parseInt(e.target.value, 10))}
            className="w-full accent-gold cursor-pointer"
          />
          <div className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-ink/45">
            <span>$200K</span>
            <span>$2M</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {copy.buyerCommissionLabel}
          </span>
          <div className="flex gap-2">
            {[2, 2.5, 3].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setBuyerPct(pct)}
                className={`flex-1 px-4 py-3 text-sm font-medium tracking-wide transition-colors border-2 ${
                  buyerPct === pct
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-gold-soft bg-ivory text-ink/70 hover:border-gold/60"
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
          <p className="text-xs text-ink/55 italic leading-relaxed">
            {copy.buyerCommissionHint}
          </p>
        </div>
      </div>

      {/* Comparison table */}
      <div className="flex flex-col gap-3">
      <p className="border-l-2 border-gold pl-3 text-xs text-ink/70 leading-relaxed">
        {copy.upfrontLegend}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-gold-soft">
          <thead>
            <tr className="bg-ivory-strong/40">
              <th className="text-left p-3 w-1/5" />
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${headerCell} ${c.isTraditional ? "text-ink/55" : "text-gold"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* UPFRONT */}
            <tr>
              <td colSpan={columns.length + 1} className={sectionRow}>
                {copy.upfrontHeader}
              </td>
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineListingFee}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipListingFee} />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.listingFee)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.linePhotos}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipPhotos} />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {c.photos === null ? (
                    <span className="text-ink/60 italic">{c.photosText}</span>
                  ) : (
                    usd(c.photos)
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineDocusign}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipDocusign} />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {c.docusign === null ? (
                    <span className="text-ink/60 italic">{copy.included}</span>
                  ) : (
                    usd(c.docusign)
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft bg-ivory-strong/20">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink/70 font-semibold">
                {copy.lineUpfrontSubtotal}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipUpfrontSubtotal}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className="p-3 text-right text-ink font-medium">
                  {usd(c.upfront)}
                </td>
              ))}
            </tr>

            {/* CLOSING */}
            <tr>
              <td colSpan={columns.length + 1} className={sectionRow}>
                {copy.closingHeader}
              </td>
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineSellerCommission}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={fillCommissionCopy(copy.tipSellerCommission)}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.sellerComm)}
                  <span className={pctTag}>({c.sellerPct}%)</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineBuyerCommission}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipBuyerCommission}
                />
                <span className="block text-[10px] text-ink/45 not-italic mt-0.5">
                  {copy.youSelected} {buyerPct}%
                </span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.buyer)}
                  <span className={pctTag}>({c.buyerPctShown}%)</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft bg-ivory-strong/20">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink/70 font-semibold">
                {copy.lineClosingSubtotal}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipClosingSubtotal}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className="p-3 text-right text-ink font-medium">
                  {usd(c.closing)}
                </td>
              ))}
            </tr>

            {/* TOTAL */}
            <tr className="border-t-2 border-gold-soft bg-ivory-strong/40">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink font-semibold">
                {copy.lineTotal}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipTotal} />
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="p-3 text-right font-display text-lg text-ink"
                >
                  {usd(c.total)}
                </td>
              ))}
            </tr>
            {/* YOU SAVE */}
            <tr className="border-t border-gold-soft bg-gold/5">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
                {copy.lineSavings}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipSavings} />
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="p-3 text-right font-display italic text-xl text-gold"
                >
                  {c.isTraditional ? (
                    <span className="text-ink/40 text-sm not-italic">—</span>
                  ) : (
                    usd(c.savings)
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      </div>

      {/* Key insight */}
      <div className="border-l-2 border-gold bg-gold/5 px-5 py-4 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
          {copy.keyInsightLabel}
        </span>
        <p className="text-sm text-ink leading-relaxed">{keyInsightText}</p>
      </div>

      {/* Explanation */}
      <details className="border border-gold-soft bg-ivory-strong/30 p-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
          {copy.howToRead}
        </summary>
        <p className="text-xs text-ink/70 leading-relaxed mt-3">
          {copy.howToReadBody}
        </p>
      </details>
    </div>
  );
}

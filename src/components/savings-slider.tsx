"use client";

// Radical Transparency calculator — full per-tier cost breakdown:
//   - Home value slider + buyer-agent commission selector (2 / 2.5 / 3 %)
//   - UPFRONT costs: listing fee, your commission, professional photos,
//     DocuSign contracts, subtotal
//   - CLOSING costs: buyer-agent commission, subtotal
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
} from "@/lib/pricing-tiers";

interface SavingsCopy {
  priceLabel: string;
  buyerCommissionLabel: string;
  buyerCommissionHint: string;
  youSelected: string;
  upfrontHeader: string;
  closingHeader: string;
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
  total: number;
  savings: number;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsSlider({ copy, tierNames }: SavingsSliderProps) {
  const [price, setPrice] = useState(500_000);
  const [buyerPct, setBuyerPct] = useState(3);

  const buyerComm = price * (buyerPct / 100);

  const tradSellerComm = price * (TRADITIONAL_COSTS.listingCommissionPct / 100);
  const tradUpfront =
    tradSellerComm + TRADITIONAL_COSTS.photography + TRADITIONAL_COSTS.docContracts;
  const tradTotal = tradUpfront + buyerComm;

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
      buyer: buyerComm,
      total: tradTotal,
      savings: 0,
    },
    ...TIER_ORDER.map((id): Column => {
      const tier = PRICING_TIERS[id];
      const sellerComm = price * (tier.commissionPct / 100);
      const upfront = tier.flatFee + sellerComm; // photos + docusign are $0
      const total = upfront + buyerComm;
      return {
        key: id,
        label: tierNames[id],
        isTraditional: false,
        listingFee: tier.flatFee,
        sellerComm,
        sellerPct: tier.commissionPct,
        photos: null,
        photosText: tier.includesPhotography ? copy.included : copy.photoDiy,
        docusign: null,
        upfront,
        buyer: buyerComm,
        total,
        savings: tradTotal - total,
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
              <td className={labelCell}>{copy.lineListingFee}</td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.listingFee)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>{copy.lineSellerCommission}</td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.sellerComm)}
                  <span className={pctTag}>({c.sellerPct}%)</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>{copy.linePhotos}</td>
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
              <td className={labelCell}>{copy.lineDocusign}</td>
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
                {copy.lineUpfrontSubtotal}
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
                {copy.lineBuyerCommission}
                <span className="block text-[10px] text-ink/45 not-italic mt-0.5">
                  {copy.youSelected} {buyerPct}%
                </span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.buyer)}
                  <span className={pctTag}>({buyerPct}%)</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft bg-ivory-strong/20">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink/70 font-semibold">
                {copy.lineClosingSubtotal}
              </td>
              {columns.map((c) => (
                <td key={c.key} className="p-3 text-right text-ink font-medium">
                  {usd(c.buyer)}
                </td>
              ))}
            </tr>

            {/* TOTAL */}
            <tr className="border-t-2 border-gold-soft bg-ivory-strong/40">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink font-semibold">
                {copy.lineTotal}
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
                {copy.lineSavings}
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

"use client";

// Radical Transparency calculator — full per-tier table with:
//   - Home value slider
//   - Buyer-agent commission selector (2 / 2.5 / 3 %)
//   - Per-tier breakdown: upfront / seller commission / buyer commission /
//     total / you-save-vs-traditional
//
// Traditional agent assumption: 6% total (3% listing + 3% buyer). When the
// user chooses a buyer commission below 3% the traditional total drops the
// same amount so we always compare apples-to-apples (the listing-side 3% is
// the only thing Lixtara replaces with its flat fee + lower commission).

import { useState } from "react";
import { PRICING_TIERS, TIER_ORDER } from "@/lib/pricing-tiers";

interface SavingsSliderProps {
  priceLabel: string;
  buyerCommissionLabel: string;
  buyerCommissionHint: string;
  lineUpfront: string;
  lineSellerCommission: string;
  lineBuyerCommission: string;
  lineTotal: string;
  lineSavings: string;
  traditionalLabel: string;
  howToRead: string;
  howToReadBody: string;
  tierNames: Record<"essentials" | "pro" | "concierge", string>;
}

const LISTING_SIDE_TRADITIONAL_PCT = 3;

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsSlider(props: SavingsSliderProps) {
  const [price, setPrice] = useState<number>(500_000);
  const [buyerPct, setBuyerPct] = useState<number>(3);

  const buyerCommissionDollars = price * (buyerPct / 100);
  const traditionalListingDollars = price * (LISTING_SIDE_TRADITIONAL_PCT / 100);
  const traditionalTotal = traditionalListingDollars + buyerCommissionDollars;

  return (
    <div className="flex flex-col gap-10">
      {/* Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {props.priceLabel}
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
            {props.buyerCommissionLabel}
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
            {props.buyerCommissionHint}
          </p>
        </div>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-gold-soft">
          <thead>
            <tr className="bg-ivory-strong/40">
              <th className="text-left p-4 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-semibold w-1/5">
                {/* header for line labels */}
              </th>
              <th className="text-right p-4 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-semibold">
                {props.traditionalLabel}
              </th>
              {TIER_ORDER.map((tierId) => (
                <th
                  key={tierId}
                  className="text-right p-4 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold"
                >
                  {props.tierNames[tierId]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gold-soft">
              <td className="p-4 text-ink/70 text-xs">{props.lineUpfront}</td>
              <td className="p-4 text-right text-ink">{formatUSD(0)}</td>
              {TIER_ORDER.map((tierId) => (
                <td key={tierId} className="p-4 text-right text-ink">
                  {formatUSD(PRICING_TIERS[tierId].flatFee)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className="p-4 text-ink/70 text-xs">
                {props.lineSellerCommission}
              </td>
              <td className="p-4 text-right text-ink">
                {formatUSD(traditionalListingDollars)}
                <span className="text-[10px] text-ink/55 ml-1">(3%)</span>
              </td>
              {TIER_ORDER.map((tierId) => {
                const pct = PRICING_TIERS[tierId].commissionPct;
                return (
                  <td key={tierId} className="p-4 text-right text-ink">
                    {formatUSD(price * (pct / 100))}
                    <span className="text-[10px] text-ink/55 ml-1">
                      ({pct}%)
                    </span>
                  </td>
                );
              })}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className="p-4 text-ink/70 text-xs">
                {props.lineBuyerCommission}
              </td>
              <td className="p-4 text-right text-ink">
                {formatUSD(buyerCommissionDollars)}
                <span className="text-[10px] text-ink/55 ml-1">
                  ({buyerPct}%)
                </span>
              </td>
              {TIER_ORDER.map((tierId) => (
                <td key={tierId} className="p-4 text-right text-ink">
                  {formatUSD(buyerCommissionDollars)}
                  <span className="text-[10px] text-ink/55 ml-1">
                    ({buyerPct}%)
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t-2 border-gold-soft bg-ivory-strong/30">
              <td className="p-4 text-[10px] uppercase tracking-[0.18em] text-ink font-semibold">
                {props.lineTotal}
              </td>
              <td className="p-4 text-right font-display text-lg text-ink">
                {formatUSD(traditionalTotal)}
              </td>
              {TIER_ORDER.map((tierId) => {
                const tier = PRICING_TIERS[tierId];
                const lixTotal =
                  tier.flatFee +
                  price * (tier.commissionPct / 100) +
                  buyerCommissionDollars;
                return (
                  <td
                    key={tierId}
                    className="p-4 text-right font-display text-lg text-ink"
                  >
                    {formatUSD(lixTotal)}
                  </td>
                );
              })}
            </tr>
            <tr className="border-t border-gold-soft bg-gold/5">
              <td className="p-4 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
                {props.lineSavings}
              </td>
              <td className="p-4 text-right text-ink/40 text-sm">—</td>
              {TIER_ORDER.map((tierId) => {
                const tier = PRICING_TIERS[tierId];
                const lixTotal =
                  tier.flatFee +
                  price * (tier.commissionPct / 100) +
                  buyerCommissionDollars;
                const savings = traditionalTotal - lixTotal;
                return (
                  <td
                    key={tierId}
                    className="p-4 text-right font-display italic text-xl text-gold"
                  >
                    {formatUSD(savings)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Explanation */}
      <details className="border border-gold-soft bg-ivory-strong/30 p-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
          {props.howToRead}
        </summary>
        <p className="text-xs text-ink/70 leading-relaxed mt-3">
          {props.howToReadBody}
        </p>
      </details>
    </div>
  );
}

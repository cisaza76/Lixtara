"use client";

// Plan-picker savings calculator: choose one Lixtara tier, slide a home
// price ($100K–$2M), pick a buyer-agent commission (2 / 2.5 / 3 %), and see
// a side-by-side comparison of total cost vs a traditional 6% agent plus
// the dollar + percent savings.

import { useState } from "react";
import Link from "next/link";
import { PRICING_TIERS, TIER_ORDER, type PricingTierId } from "@/lib/pricing-tiers";

interface SavingsCalculatorProps {
  lang: string;
  eyebrow: string;
  titleBefore: string;
  titleAccent: string;
  titleAfter: string;
  body: string;
  planLabel: string;
  priceLabel: string;
  buyerCommissionLabel: string;
  buyerCommissionRecommended: string;
  traditionalHeader: string;
  lixtaraHeader: string;
  youSaveLabel: string;
  ctaLabel: string;
  tierNames: Record<PricingTierId, string>;
}

const LISTING_SIDE_TRADITIONAL_PCT = 3;

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsCalculator({
  lang,
  eyebrow,
  titleBefore,
  titleAccent,
  titleAfter,
  body,
  planLabel,
  priceLabel,
  buyerCommissionLabel,
  buyerCommissionRecommended,
  traditionalHeader,
  lixtaraHeader,
  youSaveLabel,
  ctaLabel,
  tierNames,
}: SavingsCalculatorProps) {
  const [tierId, setTierId] = useState<PricingTierId>("pro");
  const [price, setPrice] = useState<number>(500_000);
  const [buyerPct, setBuyerPct] = useState<number>(3);

  const tier = PRICING_TIERS[tierId];
  const buyerCommission = price * (buyerPct / 100);
  const traditionalListing = price * (LISTING_SIDE_TRADITIONAL_PCT / 100);
  const traditionalTotal = traditionalListing + buyerCommission;
  const lixTotal =
    tier.flatFee + price * (tier.commissionPct / 100) + buyerCommission;
  const youSave = Math.max(0, traditionalTotal - lixTotal);
  const youSavePct =
    traditionalTotal > 0 ? (youSave / traditionalTotal) * 100 : 0;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 max-w-2xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {eyebrow}
        </p>
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal">
          {titleBefore}
          <em className="italic text-gold">{titleAccent}</em>
          {titleAfter}
        </h2>
        <p className="text-base leading-relaxed text-ink/70">{body}</p>
      </div>

      {/* Plan picker */}
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
          {planLabel}
        </span>
        <div className="grid grid-cols-3 gap-3">
          {TIER_ORDER.map((id) => {
            const t = PRICING_TIERS[id];
            const active = tierId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTierId(id)}
                className={`p-4 border-2 text-left transition-colors ${
                  active
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-gold-soft bg-ivory text-ink/70 hover:border-gold/60"
                }`}
              >
                <div className="font-display text-lg text-ink mb-1">
                  {tierNames[id]}
                </div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  ${t.flatFee} + {t.commissionPct}%
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Price slider */}
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {priceLabel}
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
            min={100_000}
            max={2_000_000}
            step={25_000}
            value={price}
            onChange={(e) => setPrice(Number.parseInt(e.target.value, 10))}
            className="w-full accent-gold cursor-pointer"
          />
          <div className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-ink/45">
            <span>$100K</span>
            <span>$2M</span>
          </div>
        </div>

        {/* Buyer commission selector */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {buyerCommissionLabel}
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
                {pct === 3 ? `${pct}%★` : `${pct}%`}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink/55 italic">
            ★ {buyerCommissionRecommended}
          </p>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gold-soft border border-gold-soft">
        <div className="bg-ivory p-6 lg:p-8 flex flex-col gap-3">
          <span className="text-[10px] uppercase tracking-[0.22em] text-ink/55 font-semibold">
            {traditionalHeader} (6%)
          </span>
          <span className="font-display text-3xl text-ink">
            {formatUSD(traditionalTotal)}
          </span>
          <span className="text-xs text-ink/55">
            3% listing + {buyerPct}% buyer agent
          </span>
        </div>
        <div className="bg-ivory p-6 lg:p-8 flex flex-col gap-3">
          <span className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
            {lixtaraHeader} {tierNames[tierId]}
          </span>
          <span className="font-display text-3xl text-ink">
            {formatUSD(lixTotal)}
          </span>
          <span className="text-xs text-ink/55">
            ${tier.flatFee} + {tier.commissionPct}% listing + {buyerPct}% buyer agent
          </span>
        </div>
      </div>

      {/* Savings hero */}
      <div className="bg-ink text-ivory p-6 lg:p-8 flex items-center justify-between gap-6 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
            {youSaveLabel}
          </span>
          <div className="flex items-baseline gap-4">
            <span className="font-display italic text-5xl lg:text-6xl text-gold leading-none">
              {formatUSD(youSave)}
            </span>
            <span className="font-display italic text-2xl text-ivory/70 leading-none">
              ({youSavePct.toFixed(1)}%)
            </span>
          </div>
        </div>
        <Link
          href={`/${lang}/listing/new?suggested_tier=${tierId}`}
          className="inline-flex items-center px-6 py-4 bg-gold text-ink text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-gold/90 transition-colors"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { PRICING_TIERS, TIER_ORDER } from "@/lib/pricing-tiers";

interface SavingsSliderProps {
  priceLabel: string;
  traditionalLabel: string;
  keepLabel: string;
  keepNote: string;
  formulaLabel: string;
  tierNames: Record<"essentials" | "pro" | "concierge", string>;
}

const TRADITIONAL_PCT = 0.06;

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsSlider({
  priceLabel,
  traditionalLabel,
  keepLabel,
  keepNote,
  formulaLabel,
  tierNames,
}: SavingsSliderProps) {
  const [price, setPrice] = useState<number>(500_000);
  const traditionalCost = price * TRADITIONAL_PCT;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {priceLabel}
          </span>
          <span className="font-display italic text-4xl text-ink leading-none">
            <span className="text-gold text-xl align-top">$</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-px bg-gold-soft border border-gold-soft">
        <div className="bg-ivory p-6 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            {traditionalLabel}
          </span>
          <span className="font-display text-2xl text-ink">
            {formatUSD(traditionalCost)}
          </span>
          <span className="text-[11px] text-ink/55">6.0%</span>
        </div>

        {TIER_ORDER.map((tierId) => {
          const tier = PRICING_TIERS[tierId];
          const lixtaraCost = tier.flatFee + price * (tier.commissionPct / 100);
          const youKeep = traditionalCost - lixtaraCost;
          return (
            <div
              key={tierId}
              className="bg-ivory p-6 flex flex-col gap-2 border-l-0 lg:border-l border-gold-soft"
            >
              <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
                {tierNames[tierId]}
              </span>
              <span className="font-display text-2xl text-ink">
                {formatUSD(lixtaraCost)}
              </span>
              <span className="text-[11px] text-ink/55">
                ${tier.flatFee} + {tier.commissionPct}%
              </span>
              <div className="border-t border-gold-soft pt-3 mt-2 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {keepLabel}
                </span>
                <span className="font-display italic text-xl text-gold leading-none">
                  {formatUSD(youKeep)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 text-xs text-ink/55 leading-relaxed">
        <p>{formulaLabel}</p>
        <p>{keepNote}</p>
      </div>
    </div>
  );
}

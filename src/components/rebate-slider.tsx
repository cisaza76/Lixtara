"use client";

import { useState } from "react";
import {
  LIXTARA_BUYER_FEE_PCT,
  REBATE_CAP,
  TYPICAL_BUYER_AGENT_PCT,
  calculateRebate,
} from "@/lib/buyer-rebate";

interface RebateSliderProps {
  priceLabel: string;
  commissionLabel: string;
  feeLabel: string;
  rebateLabel: string;
  capNotice: string;
  formulaLabel: string;
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function RebateSlider({
  priceLabel,
  commissionLabel,
  feeLabel,
  rebateLabel,
  capNotice,
  formulaLabel,
}: RebateSliderProps) {
  const [price, setPrice] = useState<number>(600_000);
  const { commissionEarned, lixtaraFee, rebate, cappedAtMax } =
    calculateRebate(price);

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
          max={5_000_000}
          step={25_000}
          value={price}
          onChange={(e) => setPrice(Number.parseInt(e.target.value, 10))}
          className="w-full accent-gold cursor-pointer"
        />
        <div className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-ink/45">
          <span>$200K</span>
          <span>$5M</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-gold-soft border border-gold-soft">
        <div className="bg-ivory p-6 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            {commissionLabel}
          </span>
          <span className="font-display text-2xl text-ink">
            {formatUSD(commissionEarned)}
          </span>
          <span className="text-[11px] text-ink/55">
            {TYPICAL_BUYER_AGENT_PCT}% offered to buyer agent
          </span>
        </div>
        <div className="bg-ivory p-6 flex flex-col gap-2 border-l-0 md:border-l border-gold-soft">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            {feeLabel}
          </span>
          <span className="font-display text-2xl text-ink">
            −{formatUSD(lixtaraFee)}
          </span>
          <span className="text-[11px] text-ink/55">
            {LIXTARA_BUYER_FEE_PCT}% Lixtara buyer-side broker
          </span>
        </div>
        <div className="bg-ink text-ivory p-6 flex flex-col gap-2 border-l-0 md:border-l border-gold-soft">
          <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
            {rebateLabel}
          </span>
          <span className="font-display italic text-3xl text-gold leading-none">
            {formatUSD(rebate)}
          </span>
          {cappedAtMax && (
            <span className="text-[11px] text-ivory/70 mt-1">
              {capNotice.replace("{cap}", `$${REBATE_CAP.toLocaleString()}`)}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-ink/55 leading-relaxed">{formulaLabel}</p>
    </div>
  );
}

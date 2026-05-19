"use client";

// Investor Club volume-discount table. Static math (no slider), one
// canonical example: 10 properties @ $400K on the Pro plan. Discounts
// apply to (flat fee + seller-side commission). Buyer-agent compensation
// is excluded from the discount per Lixtara terms.

import { PRICING_TIERS } from "@/lib/pricing-tiers";

interface InvestorClubVolumeProps {
  exampleHeader: string;
  exampleStandardLabel: string;
  exampleSilverLabel: string;
  exampleGoldLabel: string;
  examplePlatinumLabel: string;
  exampleSavingsLabel: string;
  perDealLabel: string;
  tenDealsLabel: string;
  tierStandard: string;
  tierSilver: string;
  tierGold: string;
  tierPlatinum: string;
  discountStandard: string;
  discountSilver: string;
  discountGold: string;
  discountPlatinum: string;
  footerNote: string;
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

interface Tier {
  key: "standard" | "silver" | "gold" | "platinum";
  name: string;
  discountLabel: string;
  discountPct: number;
}

export function InvestorClubVolume(props: InvestorClubVolumeProps) {
  const tiers: Tier[] = [
    { key: "standard", name: props.tierStandard, discountLabel: props.discountStandard, discountPct: 0 },
    { key: "silver", name: props.tierSilver, discountLabel: props.discountSilver, discountPct: 15 },
    { key: "gold", name: props.tierGold, discountLabel: props.discountGold, discountPct: 25 },
    { key: "platinum", name: props.tierPlatinum, discountLabel: props.discountPlatinum, discountPct: 30 },
  ];

  // Canonical example: 10 × $400K on Pro plan.
  const homePrice = 400_000;
  const deals = 10;
  const pro = PRICING_TIERS.pro;
  const perDealStandard = pro.flatFee + homePrice * (pro.commissionPct / 100);
  const totalStandard = perDealStandard * deals;

  return (
    <div className="flex flex-col gap-8">
      <div className="border border-gold-soft bg-ivory-strong/30 p-5 lg:p-6 flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
          {props.exampleHeader}
        </p>
        <p className="text-xs text-ink/55">
          {formatUSD(perDealStandard)} {props.perDealLabel} × {deals} {props.tenDealsLabel} = {formatUSD(totalStandard)} ({props.tierStandard})
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-gold-soft">
          <thead className="bg-ivory-strong/40">
            <tr>
              <th className="text-left p-4 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-semibold">
                Tier
              </th>
              <th className="text-left p-4 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-semibold">
                Discount
              </th>
              <th className="text-right p-4 text-[10px] uppercase tracking-[0.18em] text-ink/55 font-semibold">
                Total ({deals} × $400K Pro)
              </th>
              <th className="text-right p-4 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
                {props.exampleSavingsLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const total = totalStandard * (1 - t.discountPct / 100);
              const savings = totalStandard - total;
              const featured = t.key === "gold";
              return (
                <tr
                  key={t.key}
                  className={`border-t border-gold-soft ${featured ? "bg-gold/5" : ""}`}
                >
                  <td className="p-4">
                    <span
                      className={`font-display text-lg ${featured ? "text-gold" : "text-ink"}`}
                    >
                      {t.name}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-ink/80">{t.discountLabel}</td>
                  <td className="p-4 text-right font-display text-lg text-ink">
                    {formatUSD(total)}
                  </td>
                  <td className="p-4 text-right">
                    {savings > 0 ? (
                      <span className="font-display italic text-lg text-gold">
                        {formatUSD(savings)}
                      </span>
                    ) : (
                      <span className="text-ink/40 text-sm">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/55 italic leading-relaxed">
        {props.footerNote}
      </p>
    </div>
  );
}

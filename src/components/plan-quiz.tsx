import Link from "next/link";
import { PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";

interface PlanQuizProps {
  lang: string;
  valueLabel: string;
  valueUnder: string;
  valueMid: string;
  valueOver: string;
  photoLabel: string;
  photoSelf: string;
  photoPro: string;
  photoWhite: string;
  submitLabel: string;
  resultLabel: string;
  ctaLabel: string;
  whyByTier: Record<PricingTierId, string>;
  tierNames: Record<PricingTierId, string>;
  selectedValue: string | null;
  selectedPhoto: string | null;
}

function recommend(
  valueBucket: string | null,
  photoChoice: string | null,
): PricingTierId | null {
  if (!valueBucket || !photoChoice) return null;
  if (photoChoice === "white") return "concierge";
  if (photoChoice === "self") return "essentials";
  if (valueBucket === "over") return "concierge";
  if (valueBucket === "mid") return "pro";
  return "pro";
}

export function PlanQuiz({
  lang,
  valueLabel,
  valueUnder,
  valueMid,
  valueOver,
  photoLabel,
  photoSelf,
  photoPro,
  photoWhite,
  submitLabel,
  resultLabel,
  ctaLabel,
  whyByTier,
  tierNames,
  selectedValue,
  selectedPhoto,
}: PlanQuizProps) {
  const recommended = recommend(selectedValue, selectedPhoto);

  return (
    <form
      action={`/${lang}/#quiz`}
      method="get"
      className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start"
    >
      <div className="lg:col-span-7 flex flex-col gap-8">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 mb-2">
            {valueLabel}
          </legend>
          {(
            [
              { id: "under", label: valueUnder },
              { id: "mid", label: valueMid },
              { id: "over", label: valueOver },
            ] as const
          ).map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-3 p-4 border cursor-pointer transition-colors ${
                selectedValue === opt.id
                  ? "border-gold bg-ivory-strong"
                  : "border-gold-soft hover:border-gold/60"
              }`}
            >
              <input
                type="radio"
                name="qv"
                value={opt.id}
                defaultChecked={selectedValue === opt.id}
                className="accent-gold"
                required
              />
              <span className="text-sm text-ink">{opt.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 mb-2">
            {photoLabel}
          </legend>
          {(
            [
              { id: "self", label: photoSelf },
              { id: "pro", label: photoPro },
              { id: "white", label: photoWhite },
            ] as const
          ).map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-3 p-4 border cursor-pointer transition-colors ${
                selectedPhoto === opt.id
                  ? "border-gold bg-ivory-strong"
                  : "border-gold-soft hover:border-gold/60"
              }`}
            >
              <input
                type="radio"
                name="qp"
                value={opt.id}
                defaultChecked={selectedPhoto === opt.id}
                className="accent-gold"
                required
              />
              <span className="text-sm text-ink">{opt.label}</span>
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          className="self-start inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
        >
          {submitLabel}
        </button>
      </div>

      <div
        id="quiz"
        className="lg:col-span-5 border border-gold-soft p-8 flex flex-col gap-5 min-h-[260px] scroll-mt-24"
      >
        {recommended ? (
          <>
            <span className="text-[10px] uppercase tracking-[0.22em] text-ink/55">
              {resultLabel}
            </span>
            <h3 className="font-display text-4xl text-ink leading-none">
              {tierNames[recommended]}
            </h3>
            <div className="font-display italic text-2xl text-ink">
              <span className="text-gold text-base align-top">$</span>
              {PRICING_TIERS[recommended].flatFee}
              <span className="text-xs uppercase tracking-[0.18em] text-ink/55 not-italic font-sans ml-2">
                + {PRICING_TIERS[recommended].commissionPct}%
              </span>
            </div>
            <p className="text-sm text-ink/70 leading-relaxed border-t border-gold-soft pt-4">
              {whyByTier[recommended]}
            </p>
            <Link
              href={`/${lang}/listing/new?suggested_tier=${recommended}`}
              className="mt-auto inline-flex items-center justify-center px-6 py-3 border border-gold text-ink text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-gold transition-colors"
            >
              {ctaLabel}
            </Link>
          </>
        ) : (
          <div className="m-auto text-center flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.22em] text-ink/45">
              {resultLabel}
            </span>
            <p className="text-sm italic text-ink/55">—</p>
          </div>
        )}
      </div>
    </form>
  );
}

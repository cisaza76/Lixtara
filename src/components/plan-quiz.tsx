import Link from "next/link";
import { PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";
import {
  recommendTier,
  type QuizPhoto,
  type QuizValue,
} from "@/lib/plan-quiz";

export interface QuizTierDetails {
  name: string;
  tagline: string;
  /** feature lines, tier placeholders already filled */
  features: readonly string[];
  /** what this tier does NOT include */
  notIncluded: readonly string[];
}

interface PlanQuizProps {
  lang: string;
  valueLabel: string;
  valueUnder: string;
  valueMid: string;
  valueOver: string;
  photoLabel: string;
  photoSelf: string;
  photoPro: string;
  photoOwn: string;
  submitLabel: string;
  resultLabel: string;
  ctaLabel: string;
  todayLabel: string;
  atClosingLabel: string;
  termLabel: string;
  includesLabel: string;
  notIncludedLabel: string;
  notIncludedCommon: string;
  whyByTier: Record<PricingTierId, string>;
  tiers: Record<PricingTierId, QuizTierDetails>;
  selectedValue: QuizValue | null;
  selectedPhoto: QuizPhoto | null;
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
  photoOwn,
  submitLabel,
  resultLabel,
  ctaLabel,
  todayLabel,
  atClosingLabel,
  termLabel,
  includesLabel,
  notIncludedLabel,
  notIncludedCommon,
  whyByTier,
  tiers,
  selectedValue,
  selectedPhoto,
}: PlanQuizProps) {
  const recommended = recommendTier(selectedValue, selectedPhoto);

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
              { id: "own", label: photoOwn },
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
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-4xl text-ink leading-none">
                {tiers[recommended].name}
              </h3>
              <p className="text-sm text-ink/60">{tiers[recommended].tagline}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4 border-y border-gold-soft py-4">
              <div className="flex flex-col gap-1">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {todayLabel}
                </dt>
                <dd className="font-display italic text-2xl text-ink leading-none">
                  <span className="text-gold text-base align-top">$</span>
                  {PRICING_TIERS[recommended].flatFee}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  {atClosingLabel}
                </dt>
                <dd className="font-display italic text-2xl text-ink leading-none">
                  {PRICING_TIERS[recommended].commissionPct}%
                </dd>
              </div>
              <p className="col-span-2 text-[10px] uppercase tracking-[0.18em] text-ink/55">
                {termLabel}
              </p>
            </dl>
            <p className="text-sm text-ink/70 leading-relaxed">
              {whyByTier[recommended]}
            </p>
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {includesLabel}
              </span>
              <ul className="flex flex-col gap-1.5 text-sm leading-snug">
                {tiers[recommended].features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span aria-hidden className="text-gold mt-0.5 leading-none">
                      •
                    </span>
                    <span className="text-ink/80">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                {notIncludedLabel}
              </span>
              <ul className="flex flex-col gap-1.5 text-sm leading-snug">
                {[...tiers[recommended].notIncluded, notIncludedCommon].map(
                  (f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span aria-hidden className="text-ink/40 mt-0.5 leading-none">
                        –
                      </span>
                      <span className="text-ink/60">{f}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
            <Link
              href={`/${lang}/listing/new?suggested_tier=${recommended}`}
              className="mt-2 inline-flex items-center justify-center px-6 py-3 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
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

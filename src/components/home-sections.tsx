// Secciones que comparten la portada (/[lang]) y la landing de propietarios (/[lang]/owners):
// cómo funciona, la calculadora de ahorro, los planes y la lista de la FAQ. Mismo contenido y
// mismos componentes en las dos páginas; los textos salen del diccionario y de pricing-tiers.

import type { ReactNode } from "react";
import { t, type Locale } from "@/lib/i18n";
import { fillBrokerageCopy } from "@/config/brokerage";
import { buyerAgentComp } from "@/config/legal-terms";
import {
  PRICING_TIERS,
  TIER_ORDER,
  DEFAULT_TIER,
  fillCommissionCopy,
  fillTierCopy,
} from "@/lib/pricing-tiers";
import { FootnoteText } from "@/components/footnote-text";
import { ListingCtaLink } from "@/components/listing-cta-link";
import { LegalServicesDisclosure } from "@/components/legal-services-disclosure";
import { SavingsSlider } from "@/components/savings-slider";

/** Contenedor de sección y ritmo vertical de la portada y de /owners (auditoría CMO #02/#03). */
export const SECTION_X = "mx-auto w-full max-w-7xl px-6 lg:px-12";
export const SECTION_INNER = `${SECTION_X} py-14 lg:py-20`;
/** Espacio entre el título de una sección (o su encabezado) y el contenido. */
export const SECTION_TITLE_GAP = "mb-10 lg:mb-12";

/** Ancla de la calculadora de ahorro ("See what you'd pay" del hero). */
export const CALCULATOR_ANCHOR = "calculator";

export function HowItWorksSection({ lang }: { lang: Locale }) {
  const hiwCopy = t(lang).howItWorks;
  return (
    <section id="how-it-works" className="border-t border-gold-soft scroll-mt-20">
      <div className={SECTION_INNER}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
          {hiwCopy.eyebrow}
        </p>
        <h2 className={`font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl ${SECTION_TITLE_GAP}`}>
          {hiwCopy.titleBefore}
          <em className="italic text-gold">{hiwCopy.titleAccent}</em>
          {hiwCopy.titleAfter}
        </h2>

        {/* Timeline markers + connector — desktop only */}
        <div className="hidden md:grid grid-cols-4 relative mb-8">
          <div
            aria-hidden
            className="absolute top-1/2 left-[12.5%] right-[12.5%] h-px bg-gold-soft -translate-y-1/2 z-0"
          />
          {hiwCopy.steps.map((s) => (
            <div key={s.label} className="flex justify-center relative z-10">
              <div className="w-3 h-3 rounded-full bg-ivory border border-gold" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-8">
          {hiwCopy.steps.map((s) => (
            <div
              key={s.label}
              className="flex flex-col gap-3 md:items-center md:text-center"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {s.label}
              </div>
              <h3 className="text-base font-semibold text-ink leading-snug">
                {s.headline}
              </h3>
              <p className="text-sm leading-relaxed text-ink/70 md:max-w-[18rem]">
                {fillCommissionCopy(fillBrokerageCopy(s.body))}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SavingsSection({ lang }: { lang: Locale }) {
  const savingsCopy = t(lang).savings;
  const prCopy = t(lang).pricing;
  return (
    <section id={CALCULATOR_ANCHOR} className="border-t border-gold-soft bg-ivory-strong/30 scroll-mt-20">
      <div className={SECTION_INNER}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
          {savingsCopy.eyebrow}
        </p>
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-6">
          {savingsCopy.titleBefore}
          <em className="italic text-gold">{savingsCopy.titleAccent}</em>
          {savingsCopy.titleAfter}
        </h2>
        <p className={`max-w-2xl text-base leading-relaxed text-ink/70 ${SECTION_TITLE_GAP}`}>
          {fillCommissionCopy(savingsCopy.body)}
        </p>
        <SavingsSlider
          lang={lang}
          copy={{
            ...savingsCopy,
            tipSellerCommission: fillCommissionCopy(
              savingsCopy.tipSellerCommission,
            ),
            howToReadBody: fillCommissionCopy(savingsCopy.howToReadBody),
          }}
          tierNames={{
            essentials: prCopy.tiers.essentials.name,
            pro: prCopy.tiers.pro.name,
            concierge: prCopy.tiers.concierge.name,
          }}
        />
      </div>
    </section>
  );
}

export function PricingSection({ lang }: { lang: Locale }) {
  const prCopy = t(lang).pricing;
  return (
    <section id="pricing" className="border-t border-gold-soft scroll-mt-20">
      <div className={SECTION_INNER}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
          {prCopy.eyebrow}
        </p>
        <h2 className={`font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl ${SECTION_TITLE_GAP}`}>
          {prCopy.titleBefore}
          <em className="italic text-gold">{prCopy.titleAccent}</em>
          {prCopy.titleAfter}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {TIER_ORDER.map((id) => {
            const tier = PRICING_TIERS[id];
            const tCopy = prCopy.tiers[id];
            // Plan destacado visualmente (el preseleccionado), sin etiqueta de "más popular".
            const isPopular = id === DEFAULT_TIER;
            return (
              <div
                key={id}
                className={`relative flex flex-col gap-8 p-8 lg:p-10 ${
                  isPopular
                    ? "bg-ink text-ivory"
                    : "bg-ivory text-ink border border-gold-soft"
                }`}
              >
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-3xl leading-none font-normal">
                    {tCopy.name}
                  </h3>
                  <p
                    className={`text-sm leading-snug ${isPopular ? "text-ivory/70" : "text-ink/70"}`}
                  >
                    {tCopy.tagline}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="font-display italic font-normal leading-none">
                    <span className="text-gold text-3xl align-top">$</span>
                    <span className="text-6xl">
                      {tier.flatFee}
                    </span>
                  </div>
                  <p
                    className={`text-sm ${isPopular ? "text-ivory/70" : "text-ink/70"}`}
                  >
                    + {tier.commissionPct}% {prCopy.commissionLabel}
                  </p>
                  <p
                    className={`text-[10px] uppercase tracking-[0.18em] ${
                      isPopular ? "text-ivory/55" : "text-ink/55"
                    }`}
                  >
                    {prCopy.termLabel}
                  </p>
                </div>

                <div
                  className={`h-px ${isPopular ? "bg-ivory/15" : "bg-gold-soft"}`}
                />

                <p
                  className={`text-xs leading-relaxed italic ${
                    isPopular ? "text-ivory/80" : "text-ink/70"
                  }`}
                >
                  {tCopy.forWhom}
                </p>

                <ul className="flex flex-col gap-3 text-sm leading-snug flex-1">
                  {tCopy.features.map((rawFeat) => {
                    const feat = fillTierCopy(rawFeat, id);
                    return (
                    <li key={feat} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="text-gold mt-1 leading-none"
                      >
                        •
                      </span>
                      <span
                        className={isPopular ? "text-ivory" : "text-ink"}
                      >
                        <FootnoteText text={feat} lang={lang} />
                      </span>
                    </li>
                    );
                  })}
                </ul>

                <ListingCtaLink
                  href={`/${lang}/listing/new?suggested_tier=${id}`}
                  location="pricing"
                  tier={id}
                  lang={lang}
                  className={`inline-flex items-center justify-center px-6 py-4 text-xs font-medium tracking-[0.2em] uppercase transition-colors ${
                    isPopular
                      ? "bg-ivory text-ink hover:bg-ivory-strong"
                      : "bg-ink text-ivory hover:bg-ink/85"
                  }`}
                >
                  {prCopy.ctaLabel}
                </ListingCtaLink>
              </div>
            );
          })}
        </div>
        <p className="mt-10 max-w-4xl text-sm text-ink/70 leading-relaxed">
          {buyerAgentComp.text[lang].planNote}
        </p>
        {/* Servicios legales: los "*" de los planes enlazan aquí. */}
        <LegalServicesDisclosure lang={lang} anchor className="mt-4 max-w-4xl" />
      </div>
    </section>
  );
}

/** Preguntas y respuestas con el diseño de la FAQ de la portada. */
export function FaqList({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <dl className="flex flex-col">
      {items.map((item, i) => (
        <div
          key={item.q}
          className={`grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-10 py-8 lg:py-10 ${
            i === 0 ? "border-t" : ""
          } border-b border-gold-soft`}
        >
          <dt className="md:col-span-5 font-display text-xl lg:text-2xl leading-snug font-normal text-ink">
            {item.q}
          </dt>
          <dd className="md:col-span-7 text-sm lg:text-base leading-relaxed text-ink/70">
            {item.a}
          </dd>
        </div>
      ))}
    </dl>
  );
}

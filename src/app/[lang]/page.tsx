import Image from "next/image";
import Link from "next/link";
import { ListingCtaLink } from "@/components/listing-cta-link";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { BROKER_LICENSE, BROKERAGE_NAME } from "@/lib/broker";
import { DBPR_BROKERAGE_LICENSE_URL, fillBrokerageCopy } from "@/config/brokerage";
import { buyerContactHref, buyerCtaHref } from "@/lib/buyer-entry";
import { catalogHasListings } from "@/lib/catalog-status.server";
import { LegalServicesDisclosure } from "@/components/legal-services-disclosure";
import {
  fillCommissionCopy,
  fillPricingCopy,
  fillTierCopy,
  type PricingTierId,
} from "@/lib/pricing-tiers";
import { fillFromPricing } from "@/lib/pricing-from";
import {
  CALCULATOR_ANCHOR,
  FaqList,
  SECTION_INNER,
  SECTION_TITLE_GAP,
  SECTION_X,
  HowItWorksSection,
  PricingSection,
  SavingsSection,
} from "@/components/home-sections";
import { parseQuizPhoto, parseQuizValue } from "@/lib/plan-quiz";
import { PlanQuiz, type QuizTierDetails } from "@/components/plan-quiz";
import { InvestorClubVolume } from "@/components/investor-club-volume";

export default async function Home({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ qv?: string; qp?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;

  const copy = t(lang).hero;
  const vpCopy = t(lang).valueProps;
  const spCopy = t(lang).socialProof;
  const prCopy = t(lang).pricing;
  const quizCopy = t(lang).quiz;
  const investorClubCopy = t(lang).investorClub;
  const toursCopy = t(lang).tours;
  const buyerCopy = t(lang).buyerServices;
  const faqCopy = t(lang).faq;

  // Investor Club is on hold — hidden from the landing for now while we decide
  // whether/when to reintroduce it. Copy, component, and admin page are kept.
  const SHOW_INVESTOR_CLUB = false;

  const quizTier = (id: PricingTierId): QuizTierDetails => ({
    name: prCopy.tiers[id].name,
    tagline: prCopy.tiers[id].tagline,
    features: prCopy.tiers[id].features.map((f) => fillTierCopy(f, id)),
    notIncluded: prCopy.tiers[id].notIncluded,
  });

  const selectedValue = parseQuizValue(sp.qv);
  const selectedPhoto = parseQuizPhoto(sp.qp);

  // Franja de confianza del hero: solo datos con respaldo (la experiencia de la broker, con su
  // equipo aparte y sin sumar años; la publicación en el MLS). Nada de "established",
  // "verified" ni porcentajes (site-claims.test.ts).
  const experienceLine = fillBrokerageCopy(copy.experienceLine);
  // Con el catálogo vacío, los CTA de compradores van al formulario con el tema "buy".
  const hasListings = await catalogHasListings();
  const licenseText = fillBrokerageCopy(copy.licenseLabel);

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className={`${SECTION_X} pt-20 lg:pt-32 pb-10 lg:pb-12 flex-1`}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-20 items-center">
          {/* LEFT — copy */}
          <div className="lg:col-span-7 flex flex-col gap-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {copy.eyebrow}
            </p>

            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight text-ink font-normal">
              {copy.headlineBefore}
              <em className="not-italic text-gold">{copy.headlineAccent}</em>
              {copy.headlineAfter}
            </h1>

            <p className="max-w-xl text-lg leading-relaxed text-ink/70">
              {fillFromPricing(fillBrokerageCopy(copy.subheadline))}
            </p>

            {/* Botón sólido = inicio del listado; la calculadora queda como enlace (auditoría CMO #01). */}
            <div className="flex flex-col sm:flex-row gap-6 sm:items-center pt-2">
              <ListingCtaLink
                href={`/${lang}/listing/new`}
                location="home_hero"
                lang={lang}
                className="inline-flex items-center justify-center px-10 py-5 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
              >
                {copy.ctaPrimary}
              </ListingCtaLink>
              <a
                href={`#${CALCULATOR_ANCHOR}`}
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70 hover:text-gold transition-colors inline-flex items-center gap-2 group"
              >
                {copy.ctaSecondary}
                <span
                  aria-hidden
                  className="transition-transform group-hover:translate-y-0.5"
                >
                  ↓
                </span>
              </a>
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed">
              {BROKERAGE_NAME}
              <br />
              {licenseText} ·{" "}
              <a
                href={DBPR_BROKERAGE_LICENSE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-gold-soft underline-offset-4 hover:text-gold transition-colors"
              >
                {copy.verifyDbpr}
                <span className="sr-only"> {copy.opensNewTab}</span>
              </a>
            </div>

            <div className="border-t border-gold-soft pt-10 mt-4">
              <div className="flex flex-col gap-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-ink/70 leading-relaxed">
                  {experienceLine}
                </p>
                <p className="font-display text-3xl text-ink font-normal leading-none">
                  {copy.metricMlsValue}
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT — portrait composition */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="relative w-full max-w-[380px] aspect-[4/5]">
              <div
                aria-hidden
                className="absolute -top-10 -right-4 sm:-right-10 w-48 h-48 z-0 opacity-30 pointer-events-none"
                style={{
                  backgroundImage:
                    "radial-gradient(hsl(35 35% 53%) 1.5px, transparent 1.5px)",
                  backgroundSize: "14px 14px",
                }}
              />

              <Image
                src="/hero-dusk.jpg"
                alt={copy.imageAlt}
                fill
                priority
                sizes="(min-width: 1024px) 380px, 80vw"
                className="object-cover shadow-2xl"
              />

              <div className="absolute -bottom-8 -left-6 sm:-left-10 w-36 h-36 bg-ivory p-2 shadow-xl">
                <div className="border border-gold w-full h-full flex flex-col items-center justify-center text-center gap-2 px-3">
                  <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-gold">
                    {copy.badgeLicensed}
                  </div>
                  <div className="text-[10px] leading-tight tracking-[0.12em] text-ink">
                    #{BROKER_LICENSE}
                  </div>
                  <div className="w-6 h-px bg-gold-soft" />
                  <a
                    href={DBPR_BROKERAGE_LICENSE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8px] leading-tight uppercase tracking-[0.18em] text-ink/80 underline decoration-gold-soft underline-offset-2 hover:text-gold"
                  >
                    {copy.verifyDbpr}
                    <span className="sr-only"> {copy.opensNewTab}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hero → "Why Lixtara": ~88/96 px en total, no ~240 (auditoría CMO #02). */}
      <section className="border-t border-gold-soft">
        <div className={`${SECTION_X} pt-10 lg:pt-12 pb-14 lg:pb-20`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {vpCopy.eyebrow}
          </p>
          <h2 className={`font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl ${SECTION_TITLE_GAP}`}>
            {vpCopy.titleBefore}
            <em className="italic text-gold">{vpCopy.titleAccent}</em>
            {vpCopy.titleAfter}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-10 lg:gap-16">
            {vpCopy.props.map((p, i) => (
              <div
                key={p.headline}
                className="flex flex-col gap-5 pl-6 border-l border-gold-soft"
              >
                <div className="font-display italic text-5xl text-gold leading-none">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="text-base font-semibold text-ink leading-snug">
                  {p.headline}
                </h3>
                <p className="text-sm leading-relaxed text-ink/70">{fillCommissionCopy(fillBrokerageCopy(p.body))}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <HowItWorksSection lang={lang} />

      <section className="border-t border-gold-soft">
        <div className={SECTION_INNER}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {spCopy.eyebrow}
          </p>
          <h2 className={`font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl ${SECTION_TITLE_GAP}`}>
            {spCopy.titleBefore}
            <em className="italic text-gold">{spCopy.titleAccent}</em>
            {spCopy.titleAfter}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-10">
            {spCopy.testimonials.map((tst) => (
              <figure
                key={tst.attribution}
                className="flex flex-col justify-between gap-8 border border-gold-soft bg-ivory p-8 lg:p-10"
              >
                <div className="flex flex-col gap-5">
                  <div
                    aria-hidden
                    className="font-display italic text-gold text-6xl leading-none -mb-4 select-none"
                  >
                    &ldquo;
                  </div>
                  <blockquote className="font-display text-lg lg:text-xl leading-snug text-ink">
                    {tst.quote}
                  </blockquote>
                </div>
                <figcaption className="flex flex-col gap-3">
                  <div className="w-8 h-px bg-gold-soft" />
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
                    {tst.attribution}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-8 text-xs italic text-ink/55">{fillBrokerageCopy(spCopy.note)}</p>
        </div>
      </section>

      <section className="border-t border-gold-soft">
        <div className={SECTION_INNER}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {quizCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-6">
            {quizCopy.titleBefore}
            <em className="italic text-gold">{quizCopy.titleAccent}</em>
            {quizCopy.titleAfter}
          </h2>
          <p className={`max-w-2xl text-base leading-relaxed text-ink/70 ${SECTION_TITLE_GAP}`}>
            {quizCopy.body}
          </p>
          <PlanQuiz
            lang={lang}
            valueLabel={quizCopy.valueLabel}
            valueUnder={fillPricingCopy(quizCopy.valueUnder)}
            valueMid={fillPricingCopy(quizCopy.valueMid)}
            valueOver={fillPricingCopy(quizCopy.valueOver)}
            photoLabel={quizCopy.photoLabel}
            photoSelf={quizCopy.photoSelf}
            photoPro={quizCopy.photoPro}
            photoOwn={quizCopy.photoOwn}
            submitLabel={quizCopy.submit}
            resultLabel={quizCopy.resultLabel}
            ctaLabel={quizCopy.ctaLabel}
            todayLabel={quizCopy.todayLabel}
            atClosingLabel={quizCopy.atClosingLabel}
            termLabel={quizCopy.termLabel}
            includesLabel={quizCopy.includesLabel}
            notIncludedLabel={quizCopy.notIncludedLabel}
            notIncludedCommon={quizCopy.notIncludedCommon}
            whyByTier={{
              essentials: quizCopy.essentialsWhy,
              pro: quizCopy.proWhy,
              concierge: fillBrokerageCopy(quizCopy.conciergeWhy),
            }}
            tiers={{
              essentials: quizTier("essentials"),
              pro: quizTier("pro"),
              concierge: quizTier("concierge"),
            }}
            selectedValue={selectedValue}
            selectedPhoto={selectedPhoto}
          />
        </div>
      </section>

      <SavingsSection lang={lang} />

      <PricingSection lang={lang} />

      <section
        id="virtual-tours"
        className="border-t border-gold-soft bg-ivory-strong/30 scroll-mt-20"
      >
        <div className={SECTION_INNER}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
            <div className="lg:col-span-7 flex flex-col gap-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {toursCopy.eyebrow}
              </p>
              <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal">
                {toursCopy.titleBefore}
                <em className="italic text-gold">{toursCopy.titleAccent}</em>
                {toursCopy.titleAfter}
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-ink/70">
                {toursCopy.body}
              </p>
              <span className="inline-flex items-center self-start border border-gold text-ink text-[10px] font-semibold uppercase tracking-[0.22em] px-3 py-1.5 bg-ivory">
                {toursCopy.badge}
              </span>
              <p className="text-xs italic text-ink/55 leading-relaxed max-w-xl pt-2">
                {toursCopy.techNote}
              </p>
            </div>
            <ul className="lg:col-span-5 flex flex-col gap-3 border-l border-gold-soft pl-6 lg:pl-8 text-sm leading-relaxed text-ink/80">
              {[
                toursCopy.bullet1,
                toursCopy.bullet2,
                toursCopy.bullet3,
                toursCopy.bullet4,
              ].map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Compradores (decisión del 28-oct): Lixtara representa al vendedor. Sin promesas de
          acompañamiento ni representación al comprador (src/config/buyer-relationship.ts). */}
      <section
        id="buyers"
        className="border-t border-gold-soft scroll-mt-20"
      >
        <div className={SECTION_INNER}>
          <div className={`flex flex-col gap-6 max-w-3xl ${SECTION_TITLE_GAP}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {buyerCopy.eyebrow}
            </p>
            <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal">
              {buyerCopy.title}
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-ink/70">
              {buyerCopy.body}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12 mb-12">
            {[
              [buyerCopy.pillar1Title, buyerCopy.pillar1Body],
              [buyerCopy.pillar2Title, fillBrokerageCopy(buyerCopy.pillar2Body)],
              [buyerCopy.pillar3Title, buyerCopy.pillar3Body],
            ].map(([title, body]) => (
              <div key={title} className="flex flex-col gap-3 border-t border-gold-soft pt-6">
                <h3 className="font-display text-xl text-ink font-normal">{title}</h3>
                <p className="text-sm leading-relaxed text-ink/70">{body}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <Link
              href={buyerCtaHref(lang, hasListings)}
              className="inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
            >
              {hasListings ? buyerCopy.ctaPrimary : buyerCopy.ctaPrimaryNoListings}
            </Link>
            {/* Con el catálogo vacío el CTA principal ya lleva al formulario: no se repite. */}
            {hasListings && (
              <Link
                href={buyerContactHref(lang)}
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70 hover:text-gold transition-colors inline-flex items-center"
              >
                {fillBrokerageCopy(buyerCopy.ctaSecondary)} →
              </Link>
            )}
          </div>
        </div>
      </section>

      {SHOW_INVESTOR_CLUB && (
      <section
        id="investor-club"
        className="border-t border-gold-soft scroll-mt-20"
      >
        <div className={SECTION_INNER}>
          <div className={`flex flex-col gap-5 ${SECTION_TITLE_GAP}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {investorClubCopy.eyebrow}
            </p>
            <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl">
              {investorClubCopy.titleBefore}
              <em className="italic text-gold">{investorClubCopy.titleAccent}</em>
              {investorClubCopy.titleAfter}
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-ink/70">
              {investorClubCopy.body}
            </p>
          </div>

          <InvestorClubVolume
            exampleHeader={investorClubCopy.exampleHeader}
            exampleStandardLabel={investorClubCopy.exampleStandardLabel}
            exampleSilverLabel={investorClubCopy.exampleSilverLabel}
            exampleGoldLabel={investorClubCopy.exampleGoldLabel}
            examplePlatinumLabel={investorClubCopy.examplePlatinumLabel}
            exampleSavingsLabel={investorClubCopy.exampleSavingsLabel}
            perDealLabel={investorClubCopy.perDealLabel}
            tenDealsLabel={investorClubCopy.tenDealsLabel}
            tierStandard={investorClubCopy.tierStandard}
            tierSilver={investorClubCopy.tierSilver}
            tierGold={investorClubCopy.tierGold}
            tierPlatinum={investorClubCopy.tierPlatinum}
            discountStandard={investorClubCopy.discountStandard}
            discountSilver={investorClubCopy.discountSilver}
            discountGold={investorClubCopy.discountGold}
            discountPlatinum={investorClubCopy.discountPlatinum}
            footerNote={investorClubCopy.footerNote}
            tableTier={investorClubCopy.tableTier}
            tableDiscount={investorClubCopy.tableDiscount}
            tableTotal={investorClubCopy.tableTotal}
          />

          <div className="mt-10 lg:mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
            <div className="border border-gold-soft bg-ivory-strong/30 p-6 flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {investorClubCopy.requirementsTitle}
              </p>
              <ul className="flex flex-col gap-2 text-sm text-ink/80 leading-relaxed">
                <li className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{investorClubCopy.requirementClosed}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{investorClubCopy.requirementListing}</span>
                </li>
              </ul>
            </div>
            <div className="flex items-center justify-center md:justify-end">
              <Link
                href={`/${lang}/contact?topic=investor-club`}
                className="inline-flex items-center justify-center px-10 py-5 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
              >
                {investorClubCopy.applyCta}
              </Link>
            </div>
          </div>
        </div>
      </section>
      )}

      <section id="faq" className="border-t border-gold-soft scroll-mt-20">
        <div className={SECTION_INNER}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {faqCopy.eyebrow}
          </p>
          <h2 className={`font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl ${SECTION_TITLE_GAP}`}>
            {faqCopy.titleBefore}
            <em className="italic text-gold">{faqCopy.titleAccent}</em>
            {faqCopy.titleAfter}
          </h2>

          <FaqList
            items={faqCopy.items.map((item) => ({ q: item.q, a: fillPricingCopy(fillBrokerageCopy(item.a)) }))}
          />
          <LegalServicesDisclosure lang={lang} className="mt-8 max-w-4xl" />
        </div>
      </section>

    </main>
  );
}

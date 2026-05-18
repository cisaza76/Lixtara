import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import {
  BROKER_LICENSE,
  BROKERAGE_NAME,
  BROKERAGE_LICENSED_ENTITY,
} from "@/lib/broker";
import { BROKER_STATS } from "@/lib/broker-stats";
import {
  PRICING_TIERS,
  TIER_ORDER,
  DEFAULT_TIER,
  formatPrice,
} from "@/lib/pricing-tiers";
import { PlanQuiz } from "@/components/plan-quiz";
import { SavingsSlider } from "@/components/savings-slider";
import { RebateSlider } from "@/components/rebate-slider";

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
  const hiwCopy = t(lang).howItWorks;
  const spCopy = t(lang).socialProof;
  const prCopy = t(lang).pricing;
  const quizCopy = t(lang).quiz;
  const savingsCopy = t(lang).savings;
  const rebateCopy = t(lang).rebate;
  const investorCopy = t(lang).investor;
  const faqCopy = t(lang).faq;

  const selectedValue =
    sp.qv === "under" || sp.qv === "mid" || sp.qv === "over" ? sp.qv : null;
  const selectedPhoto =
    sp.qp === "self" || sp.qp === "pro" || sp.qp === "white" ? sp.qp : null;

  const visibleMetrics: Array<{ value: string; label: string }> = [];
  if (BROKER_STATS.salesVolume) {
    visibleMetrics.push({
      value: BROKER_STATS.salesVolume,
      label: copy.metricVolumeLabel,
    });
  }
  if (BROKER_STATS.yearsExperience) {
    visibleMetrics.push({
      value: `${BROKER_STATS.yearsExperience} Yrs`,
      label: copy.metricYearsLabel,
    });
  }
  visibleMetrics.push({
    value: BROKER_STATS.mlsCoverage,
    label: copy.metricMlsLabel,
  });

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-32 flex-1">
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
              {copy.subheadline}
            </p>

            <div className="flex flex-col sm:flex-row gap-6 sm:items-center pt-2">
              <Link
                href={`/${lang}/listing/new`}
                className="inline-flex items-center justify-center px-10 py-5 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
              >
                {copy.ctaPrimary}
              </Link>
              <Link
                href={`/${lang}/properties`}
                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70 hover:text-gold transition-colors inline-flex items-center gap-2 group"
              >
                {copy.ctaSecondary}
                <span
                  aria-hidden
                  className="transition-transform group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed">
              {BROKERAGE_NAME}
              <br />
              {copy.licensedBy} {BROKERAGE_LICENSED_ENTITY} · #
              {BROKER_LICENSE}
            </div>

            <div className="border-t border-gold-soft pt-10 mt-4">
              <dl
                className={`grid gap-10 ${
                  visibleMetrics.length === 1
                    ? "grid-cols-1"
                    : visibleMetrics.length === 2
                      ? "grid-cols-2"
                      : "grid-cols-3"
                }`}
              >
                {visibleMetrics.map((m) => (
                  <div key={m.label} className="flex flex-col gap-2">
                    <dd className="font-display text-3xl text-ink font-normal leading-none">
                      {m.value}
                    </dd>
                    <dt className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                      {m.label}
                    </dt>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* RIGHT — portrait composition */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="relative w-full max-w-[380px] aspect-[4/5]">
              <div
                aria-hidden
                className="absolute -top-10 -right-10 w-48 h-48 z-0 opacity-30 pointer-events-none"
                style={{
                  backgroundImage:
                    "radial-gradient(hsl(35 35% 53%) 1.5px, transparent 1.5px)",
                  backgroundSize: "14px 14px",
                }}
              />

              <Image
                src="/placeholder-property.svg"
                alt="Lixtara — Florida residential brokerage (property image placeholder)"
                fill
                priority
                sizes="(min-width: 1024px) 380px, 80vw"
                className="object-cover shadow-2xl"
              />

              <div className="absolute -bottom-8 -left-6 sm:-left-10 w-36 h-36 bg-ivory p-2 shadow-xl">
                <div className="border border-gold w-full h-full flex flex-col items-center justify-center text-center gap-2 px-3">
                  <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-gold">
                    {copy.badgeVerified}
                  </div>
                  <div className="w-6 h-px bg-gold-soft" />
                  <div className="text-[8px] leading-tight uppercase tracking-[0.18em] text-ink/80">
                    {copy.badgeBrokerage}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {vpCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-16 lg:mb-20">
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
                <p className="text-sm leading-relaxed text-ink/70">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-gold-soft scroll-mt-20">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {hiwCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-16 lg:mb-20">
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
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-gold-soft">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {spCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-16 lg:mb-20">
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
        </div>
      </section>

      <section className="border-t border-gold-soft">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {quizCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-6">
            {quizCopy.titleBefore}
            <em className="italic text-gold">{quizCopy.titleAccent}</em>
            {quizCopy.titleAfter}
          </h2>
          <p className="max-w-2xl text-base leading-relaxed text-ink/70 mb-12 lg:mb-16">
            {quizCopy.body}
          </p>
          <PlanQuiz
            lang={lang}
            valueLabel={quizCopy.valueLabel}
            valueUnder={quizCopy.valueUnder}
            valueMid={quizCopy.valueMid}
            valueOver={quizCopy.valueOver}
            photoLabel={quizCopy.photoLabel}
            photoSelf={quizCopy.photoSelf}
            photoPro={quizCopy.photoPro}
            photoWhite={quizCopy.photoWhite}
            submitLabel={quizCopy.submit}
            resultLabel={quizCopy.resultLabel}
            ctaLabel={quizCopy.ctaLabel}
            whyByTier={{
              essentials: quizCopy.essentialsWhy,
              pro: quizCopy.proWhy,
              concierge: quizCopy.conciergeWhy,
            }}
            tierNames={{
              essentials: prCopy.tiers.essentials.name,
              pro: prCopy.tiers.pro.name,
              concierge: prCopy.tiers.concierge.name,
            }}
            selectedValue={selectedValue}
            selectedPhoto={selectedPhoto}
          />
        </div>
      </section>

      <section className="border-t border-gold-soft bg-ivory-strong/30">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {savingsCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-6">
            {savingsCopy.titleBefore}
            <em className="italic text-gold">{savingsCopy.titleAccent}</em>
            {savingsCopy.titleAfter}
          </h2>
          <p className="max-w-2xl text-base leading-relaxed text-ink/70 mb-12 lg:mb-16">
            {savingsCopy.body}
          </p>
          <SavingsSlider
            priceLabel={savingsCopy.priceLabel}
            traditionalLabel={savingsCopy.traditionalLabel}
            keepLabel={savingsCopy.keepLabel}
            keepNote={savingsCopy.keepNote}
            formulaLabel={savingsCopy.formulaLabel}
            tierNames={{
              essentials: prCopy.tiers.essentials.name,
              pro: prCopy.tiers.pro.name,
              concierge: prCopy.tiers.concierge.name,
            }}
          />
        </div>
      </section>

      <section id="pricing" className="border-t border-gold-soft scroll-mt-20">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {prCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-16 lg:mb-20">
            {prCopy.titleBefore}
            <em className="italic text-gold">{prCopy.titleAccent}</em>
            {prCopy.titleAfter}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {TIER_ORDER.map((id) => {
              const tier = PRICING_TIERS[id];
              const tCopy = prCopy.tiers[id];
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
                  {isPopular && (
                    <div className="absolute -top-3 left-8 lg:left-10 bg-gold text-ink text-[10px] font-semibold uppercase tracking-[0.22em] px-3 py-1">
                      {prCopy.popularBadge}
                    </div>
                  )}

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
                    {tCopy.features.map((feat) => (
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
                          {feat}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={`/${lang}/listing/new?tier=${id}`}
                    className={`inline-flex items-center justify-center px-6 py-4 text-xs font-medium tracking-[0.2em] uppercase transition-colors ${
                      isPopular
                        ? "bg-ivory text-ink hover:bg-ivory-strong"
                        : "bg-ink text-ivory hover:bg-ink/85"
                    }`}
                  >
                    {prCopy.ctaLabel}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="buyer-rebate"
        className="border-t border-gold-soft scroll-mt-20"
      >
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start mb-16 lg:mb-20">
            <div className="lg:col-span-7 flex flex-col gap-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                {rebateCopy.eyebrow}
              </p>
              <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal">
                {rebateCopy.titleBefore}
                <em className="italic text-gold">{rebateCopy.titleAccent}</em>
                {rebateCopy.titleAfter}
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-ink/70">
                {rebateCopy.body}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 sm:items-center pt-2">
                <Link
                  href={`/${lang}/properties`}
                  className="inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
                >
                  {rebateCopy.ctaPrimary}
                </Link>
                <Link
                  href={`/${lang}/contact?topic=buyer-rebate`}
                  className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70 hover:text-gold transition-colors inline-flex items-center"
                >
                  {rebateCopy.ctaSecondary} →
                </Link>
              </div>
            </div>
            <ul className="lg:col-span-5 flex flex-col gap-3 border-l border-gold-soft pl-6 lg:pl-8 text-sm leading-relaxed text-ink/80">
              {[
                rebateCopy.bullet1,
                rebateCopy.bullet2,
                rebateCopy.bullet3,
                rebateCopy.bullet4,
              ].map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span aria-hidden className="text-gold mt-1 leading-none">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <RebateSlider
            priceLabel={rebateCopy.priceLabel}
            commissionLabel={rebateCopy.commissionLabel}
            feeLabel={rebateCopy.feeLabel}
            rebateLabel={rebateCopy.rebateLabel}
            capNotice={rebateCopy.capNotice}
            formulaLabel={rebateCopy.formulaLabel}
          />
        </div>
      </section>

      <section
        id="investor-club"
        className="border-t border-gold-soft bg-ink text-ivory scroll-mt-20"
      >
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <div className="flex flex-col gap-5 mb-12 lg:mb-16">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {investorCopy.eyebrow}
            </p>
            <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ivory font-normal max-w-2xl">
              {investorCopy.titleBefore}
              <em className="italic text-gold">{investorCopy.titleAccent}</em>
              {investorCopy.titleAfter}
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-ivory/70">
              {investorCopy.body}
            </p>
            <span className="inline-flex items-center self-start border border-gold text-gold text-[10px] font-semibold uppercase tracking-[0.22em] px-3 py-1.5">
              {investorCopy.waitlistBadge}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {(["silver", "gold", "platinum"] as const).map((tierId) => {
              const tCopy = investorCopy.tiers[tierId];
              const isFeatured = tierId === "gold";
              return (
                <div
                  key={tierId}
                  className={`flex flex-col gap-6 p-8 lg:p-10 ${
                    isFeatured
                      ? "bg-ivory text-ink border border-gold"
                      : "border border-ivory/15"
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    <h3 className="font-display text-3xl font-normal leading-none">
                      {tCopy.name}
                    </h3>
                    <p
                      className={`text-sm ${isFeatured ? "text-ink/70" : "text-ivory/65"}`}
                    >
                      {tCopy.tagline}
                    </p>
                  </div>
                  <div
                    className={`h-px ${isFeatured ? "bg-gold-soft" : "bg-ivory/15"}`}
                  />
                  <ul className="flex flex-col gap-3 text-sm leading-snug flex-1">
                    {tCopy.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3">
                        <span aria-hidden className="text-gold mt-1 leading-none">
                          •
                        </span>
                        <span className={isFeatured ? "text-ink" : "text-ivory"}>
                          {b}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-12 lg:mt-16 flex justify-center">
            <Link
              href={`/${lang}/contact?topic=investor-club`}
              className="inline-flex items-center justify-center px-10 py-5 bg-gold text-ink text-xs font-medium tracking-[0.2em] uppercase hover:bg-gold/90 transition-colors"
            >
              {investorCopy.ctaWaitlist}
            </Link>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-gold-soft scroll-mt-20">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
            {faqCopy.eyebrow}
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-2xl mb-12 lg:mb-16">
            {faqCopy.titleBefore}
            <em className="italic text-gold">{faqCopy.titleAccent}</em>
            {faqCopy.titleAfter}
          </h2>

          <dl className="flex flex-col">
            {faqCopy.items.map((item, i) => (
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
        </div>
      </section>

    </main>
  );
}

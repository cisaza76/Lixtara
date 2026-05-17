import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { BROKER_LICENSE, BROKER_NAME, BROKERAGE_NAME } from "@/lib/broker";
import { BROKER_STATS } from "@/lib/broker-stats";

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const copy = t(lang).hero;
  const altLang: Locale = lang === "en" ? "es" : "en";

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
              <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed">
                {BROKERAGE_NAME}
                <br />
                {copy.licenseCaption}
                {BROKER_LICENSE}
              </div>
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
                src="/placeholder-broker.svg"
                alt={`${BROKER_NAME} — Lixtara licensed broker (portrait pending)`}
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

      <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 pb-10">
        <Link
          href={`/${altLang}`}
          className="text-[10px] uppercase tracking-[0.22em] text-ink/50 hover:text-gold transition-colors"
        >
          {copy.langToggle}
        </Link>
      </div>
    </main>
  );
}

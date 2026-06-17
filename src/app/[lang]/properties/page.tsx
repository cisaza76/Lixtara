import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { getActiveProperties, isDemoListing } from "@/lib/properties";
import { PropertyCard } from "@/components/property-card";

export default async function PropertiesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const copy = t(lang).properties;
  const properties = await getActiveProperties();

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold mb-5">
          {copy.eyebrow}
        </p>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-16 lg:mb-20">
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight text-ink font-normal max-w-2xl">
            {copy.titleBefore}
            <em className="italic text-gold">{copy.titleAccent}</em>
            {copy.titleAfter}
          </h1>
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink/55">
            {properties.length}{" "}
            {properties.length === 1 ? copy.countSuffixOne : copy.countSuffixMany}
          </p>
        </div>

        {properties.length === 0 ? (
          <p className="text-lg text-ink/70 leading-relaxed max-w-xl">
            {copy.emptyState}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12 lg:gap-x-10 lg:gap-y-16">
            {properties.map((p, i) => (
              <PropertyCard
                key={p.id}
                lang={lang}
                property={p}
                isDemo={isDemoListing(p.address_street)}
                priority={i < 3}
                labels={{
                  viewDetails: copy.card.viewDetails,
                  forSale: copy.card.forSale,
                  bedsShort: copy.card.bedsShort,
                  bathsShort: copy.card.bathsShort,
                  sqftSuffix: copy.card.sqftSuffix,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

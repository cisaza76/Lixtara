import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import {
  getActiveProperties,
  formatPropertyPrice,
  isDemoListing,
  cleanDemoPrefix,
} from "@/lib/properties";

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
            {properties.map((p) => (
              <Link
                key={p.id}
                href={`/${lang}/property/${p.id}`}
                className="group flex flex-col gap-5"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-ivory-strong">
                  {p.primary_photo_url ? (
                    <Image
                      src={p.primary_photo_url}
                      alt={cleanDemoPrefix(p.address_street)}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink/30 text-xs uppercase tracking-[0.18em]">
                      No photo
                    </div>
                  )}
                  {isDemoListing(p.address_street) && (
                    <div className="absolute top-3 left-3 bg-ivory text-ink text-[9px] font-semibold tracking-[0.22em] uppercase px-2 py-1">
                      Demo
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="font-display text-2xl lg:text-3xl text-ink leading-none">
                    {formatPropertyPrice(p.list_price)}
                  </div>
                  <div className="text-sm text-ink leading-snug">
                    {cleanDemoPrefix(p.address_street)}
                  </div>
                  <div className="text-sm text-ink/60 leading-snug">
                    {p.address_city}, {p.address_state} {p.address_zip}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-[11px] uppercase tracking-[0.15em] text-ink/55">
                    <span>
                      {p.bedrooms} {copy.card.bedsShort}
                    </span>
                    <span className="text-gold-soft">·</span>
                    <span>
                      {p.bathrooms} {copy.card.bathsShort}
                    </span>
                    <span className="text-gold-soft">·</span>
                    <span>
                      {p.sqft.toLocaleString()} {copy.card.sqftSuffix}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

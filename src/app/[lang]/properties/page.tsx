import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { getActiveProperties, getActiveListingMlsRefs, isDemoListing } from "@/lib/properties";
import { PropertyCard } from "@/components/property-card";
import { getPublicMlsListings } from "@/lib/mls/public-listings.supabase";
import { MlsListingCard } from "@/components/mls-listing-card";
import { MlsDisclosures } from "@/components/mls-disclosures";

export default async function PropertiesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const copy = t(lang).properties;
  const properties = await getActiveProperties();

  // Inventario de terceros del feed IDX, ya deduplicado contra los listings propios.
  // Cuando el gate niega —preview, sin flag, o host no licenciado— devuelve vacío y la
  // página queda exactamente como antes: solo listings propios.
  const mlsRefs = await getActiveListingMlsRefs();
  const mls = await getPublicMlsListings(mlsRefs, lang);
  const total = properties.length + mls.listings.length;

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
            {total}{" "}
            {total === 1 ? copy.countSuffixOne : copy.countSuffixMany}
          </p>
        </div>

        {total === 0 ? (
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

            {/* Inventario de terceros. Cada tarjeta lleva su atribución obligatoria; no
                es una prop opcional, va dentro del componente. */}
            {mls.listings.map((l) => (
              <MlsListingCard key={l.listingKey} listing={l} />
            ))}
          </div>
        )}

        {/* Avisos del MLS SOLO si hay contenido licenciado en pantalla: mostrarlos sin
            fichas del feed confundiría el origen de los listings propios. */}
        {mls.listings.length > 0 && (
          <MlsDisclosures lang={lang} year={new Date().getUTCFullYear()} />
        )}
      </section>
    </main>
  );
}

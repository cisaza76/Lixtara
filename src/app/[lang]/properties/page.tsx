import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { getActiveProperties, getActiveListingMlsRefs, isDemoListing } from "@/lib/properties";
import { PropertyCard } from "@/components/property-card";
import { getPublicMlsListings } from "@/lib/mls/public-listings.supabase";
import { MlsListingCard } from "@/components/mls-listing-card";
import { MlsDisclosures } from "@/components/mls-disclosures";
import { PropertySearchForm } from "@/components/property-search-form";
import { PaginationNav } from "@/components/pagination-nav";
import {
  MAX_PAGE,
  PAGE_SIZE,
  hasActiveFilters,
  isTruncated,
  ownListingMatches,
  pageCount,
  parsePropertySearch,
  propertySearchQuery,
  type RawSearchParams,
} from "@/lib/property-search";

export default async function PropertiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const search = parsePropertySearch(await searchParams);

  const copy = t(lang).properties;
  // Los listings propios son pocos: se filtran en memoria y van solo en la página 1,
  // antes del inventario del feed.
  const ownMatches = (await getActiveProperties()).filter((p) => ownListingMatches(p, search));
  const properties = search.page === 1 ? ownMatches : [];

  // Inventario de terceros del feed IDX, filtrado y paginado en la base, ya deduplicado
  // contra los listings propios. Cuando el gate niega —preview, sin flag, o host no
  // licenciado— devuelve vacío y la página muestra solo los listings propios.
  const mlsRefs = await getActiveListingMlsRefs();
  const mls = await getPublicMlsListings(mlsRefs, lang, search);
  const total = ownMatches.length + mls.total;
  const pages = pageCount(mls.total);
  const hrefFor = (page: number) => `/${lang}/properties${propertySearchQuery(search, { page })}`;

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

        <PropertySearchForm lang={lang} search={search} labels={copy.filters} />

        {total === 0 ? (
          <p className="text-lg text-ink/70 leading-relaxed max-w-xl">
            {hasActiveFilters(search) ? copy.filters.noResults : copy.emptyState}
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
                  noPhoto: copy.card.noPhoto,
                  demo: copy.card.demo,
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

        <PaginationNav
          page={Math.min(search.page, pages)}
          pages={pages}
          hrefFor={hrefFor}
          labels={copy.pagination}
        />
        {isTruncated(mls.total) && (
          <p className="mt-6 text-sm text-ink/60 text-center">
            {copy.pagination.truncated.replace("{shown}", (PAGE_SIZE * MAX_PAGE).toLocaleString(lang))}
          </p>
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

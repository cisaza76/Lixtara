// Tarjeta de una ficha del feed IDX (inventario de terceros).
//
// Separada de PropertyCard a propósito: esta SIEMPRE lleva la atribución del Schedule A §9,
// y esa obligación no puede quedar como una prop opcional que alguien olvide pasar.
//
// Tipografía de la atribución: `ATTRIBUTION_TYPOGRAPHY`, no una clase suelta. El §9 exige
// que no sea menor que la mediana de la ficha — la letra chica es justo donde el instinto
// de diseño la pondría, y hay un test que lo impide.
import { ATTRIBUTION_TYPOGRAPHY } from "@/lib/mls/display-compliance";
import type { MlsPublicListing } from "@/lib/mls/public-listings";

export function MlsListingCard({ listing }: { listing: MlsPublicListing }) {
  const precio =
    listing.listPrice === null
      ? null
      : new Intl.NumberFormat("en-US", {
          style: "currency", currency: "USD", maximumFractionDigits: 0,
        }).format(listing.listPrice);

  const ubicacion = [listing.city, listing.postalCode].filter(Boolean).join(", ");

  return (
    <article className="flex flex-col gap-3 border border-gold-soft p-5">
      <div className="flex items-baseline justify-between gap-3">
        {precio && (
          <span className="font-display text-2xl text-ink leading-none">{precio}</span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold shrink-0">
          MLS
        </span>
      </div>

      {ubicacion && <p className="text-sm text-ink/70">{ubicacion}</p>}

      {/* Obligatorio (Schedule A §9). No es opcional ni condicional. */}
      <p className={ATTRIBUTION_TYPOGRAPHY}>{listing.attribution.courtesyLine}</p>

      {listing.attribution.extraFields.length > 0 && (
        <p className="text-sm text-ink/70">
          {listing.attribution.extraFields.join(" · ")}
        </p>
      )}
    </article>
  );
}

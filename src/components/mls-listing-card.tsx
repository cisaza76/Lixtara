// Tarjeta de una ficha del feed IDX (inventario de terceros).
//
// Separada de PropertyCard a propósito: esta SIEMPRE lleva la atribución del Schedule A §9,
// y esa obligación no puede quedar como una prop opcional que alguien olvide pasar.
//
// Tipografía de la atribución: `ATTRIBUTION_TYPOGRAPHY`, no una clase suelta. El §9 exige
// que no sea menor que la mediana de la ficha — la letra chica es justo donde el instinto
// de diseño la pondría, y hay un test que lo impide.
//
// Foto por HOT-LINK con un <img> simple, NO con next/image: el optimizador de Vercel
// descargaría la imagen y guardaría copias en su caché, que es justo lo que § III.B.9
// prohíbe y lo que complicaría la purga del § VI.C. El navegador la pide directo al CDN
// del MLS. `photo-hotlink.test.ts` impide volver a next/image aquí.
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
      <div className="relative aspect-[4/3] -mx-5 -mt-5 mb-1 overflow-hidden border-b border-gold-soft bg-ivory-strong">
        {listing.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- hot-link obligatorio, ver arriba
          <img
            src={listing.photoUrl}
            alt={listing.photoAlt}
            width={800}
            height={600}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.18em] text-ink/30"
          >
            MLS
          </div>
        )}
      </div>

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

// Unificación del inventario público: los listings propios de `properties` más el
// inventario de terceros del feed IDX, deduplicados.
//
// POR QUÉ HACE FALTA DEDUPLICAR: MIAMI confirmó por escrito que el feed IDX **incluye los
// listings de la propia correduría**. Sin cruzarlos, cada propiedad de un vendedor de
// Lixtara aparecería DOS veces en /properties — una desde `properties` y otra desde el
// feed.
//
// CLAVE DEL CRUCE: `properties.mls_number` ↔ `mls_listings.listing_id`. La columna ya
// existe con constraint UNIQUE desde el baseline.
//
// SOLO LECTURA. El cruce se hace en memoria al renderizar y NO escribe `mls_number` en
// `properties`. § III.B.9 prohíbe "download, distribute, export, deliver, or transmit any
// of the Licensed Content ... except Participant's Website", y escribir en la base propia
// es procesamiento, no exhibición. Hasta que haya respuesta del abogado, Anamaria anota el
// número a mano desde Matrix — es un campo por listing.
//
// PURO: sin I/O.
import type { Locale } from "@/lib/i18n";
import {
  displayEligibility,
  listingAttribution,
  type ListingAttribution,
} from "@/lib/mls/display-compliance";

/** Lo que el feed aporta a una ficha pública. Proyección de `mls_listings`. */
export interface MlsPublicRow {
  listing_key: string;
  listing_id: string;
  mls_status: string;
  withdrawn_at: string | null;
  list_price: number | null;
  city: string | null;
  postal_code: string | null;
  list_office_name: string | null;
  list_agent_name: string | null;
  list_office_phone: string | null;
  list_office_email: string | null;
  list_agent_phone: string | null;
  list_agent_email: string | null;
}

/** Lo mínimo que el cruce necesita de un listing propio. */
export interface OwnListingRef {
  id: string;
  /** `properties.mls_number`. null mientras no se haya anotado. */
  mlsNumber: string | null;
}

export interface MlsPublicListing {
  source: "mls";
  listingKey: string;
  listingId: string;
  listPrice: number | null;
  city: string | null;
  postalCode: string | null;
  /** Schedule A §9. Nunca null para una ficha de tercero. */
  attribution: ListingAttribution;
}

export type DedupeReason = "own_listing" | "not_displayable" | "withdrawn";

export interface MergeResult {
  /** Fichas de terceros que sí se muestran, ya con su atribución. */
  mlsListings: MlsPublicListing[];
  /** Descartadas, con el motivo. Para diagnóstico, no para la UI. */
  suppressed: Array<{ listingId: string; reason: DedupeReason }>;
}

/**
 * Cruza el feed contra los listings propios y aplica la elegibilidad de exhibición.
 *
 * El orden importa: primero se descarta lo propio (aunque sea elegible), porque
 * renderizarlo desde `properties` es SIEMPRE preferible — esa fila tiene las fotos del
 * vendedor, el staging IA y el video de Creative Studio, y además no lleva atribución de
 * tercero porque la agencia listadora somos nosotros.
 */
export function mergePublicListings(
  own: OwnListingRef[],
  feed: MlsPublicRow[],
  lang: Locale,
): MergeResult {
  // Índice de los números de MLS ya cubiertos por un listing propio. Se normaliza a
  // minúsculas sin espacios: el mismo número tecleado a mano en Matrix y devuelto por el
  // feed puede diferir en formato.
  const propios = new Set(
    own
      .map((o) => normalizeMlsNumber(o.mlsNumber))
      .filter((n): n is string => n !== null),
  );

  const mlsListings: MlsPublicListing[] = [];
  const suppressed: MergeResult["suppressed"] = [];

  for (const row of feed) {
    const num = normalizeMlsNumber(row.listing_id);
    if (num !== null && propios.has(num)) {
      suppressed.push({ listingId: row.listing_id, reason: "own_listing" });
      continue;
    }

    const elegible = displayEligibility({
      mlsStatus: row.mls_status,
      withdrawnAt: row.withdrawn_at,
    });
    if (!elegible.displayable) {
      suppressed.push({
        listingId: row.listing_id,
        reason: elegible.reason === "withdrawn" ? "withdrawn" : "not_displayable",
      });
      continue;
    }

    mlsListings.push({
      source: "mls",
      listingKey: row.listing_key,
      listingId: row.listing_id,
      listPrice: row.list_price,
      city: row.city,
      postalCode: row.postal_code,
      attribution: listingAttribution(
        {
          listOfficeName: row.list_office_name,
          listAgentName: row.list_agent_name,
          listOfficePhone: row.list_office_phone,
          listOfficeEmail: row.list_office_email,
          listAgentPhone: row.list_agent_phone,
          listAgentEmail: row.list_agent_email,
          // Si llegó hasta aquí NO es nuestro: el cruce de arriba ya sacó los propios.
          isOwnBrokerage: false,
        },
        lang,
      ),
    });
  }

  return { mlsListings, suppressed };
}

/**
 * Normaliza un número de MLS para comparar. Anamaria lo teclea a mano desde Matrix, así
 * que puede traer espacios o mayúsculas distintas a las del feed; comparar en crudo
 * fallaría el cruce y la propiedad saldría duplicada.
 */
export function normalizeMlsNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.replace(/\s+/g, "").toUpperCase();
  return limpio.length > 0 ? limpio : null;
}

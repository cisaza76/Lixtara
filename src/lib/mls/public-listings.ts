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
import { normalizeMlsNumber } from "@/lib/listing-mls-number";

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
  /**
   * `payload->Media` del RESO (arreglo de fotos). Sin tipar a propósito: viene tal cual del
   * proveedor y `primaryMlsPhotoUrl` lo valida. Opcional para que las proyecciones viejas
   * sigan valiendo.
   */
  media?: unknown;
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
  /**
   * Foto principal por HOT-LINK al CDN del MLS: la URL del feed, sin descargarla ni
   * guardarla (§ III.B.9; purga trivial bajo § VI.C). null = sin foto utilizable.
   */
  photoUrl: string | null;
  photoAlt: string;
  /** Schedule A §9. Nunca null para una ficha de tercero. */
  attribution: ListingAttribution;
}

/**
 * Foto principal de una ficha a partir de `payload->Media`.
 *
 * Elige el elemento con menor `Order` entre los que son foto (`MediaCategory` "Photo", o
 * sin categoría) y traen una `MediaURL` https. Todo lo demás —documentos, videos, URLs
 * http o con forma rara— se ignora: mejor el recuadro vacío que una imagen rota o mixta.
 */
export function primaryMlsPhotoUrl(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  let bestUrl: string | null = null;
  let bestOrder = Infinity;
  for (const m of media) {
    if (typeof m !== "object" || m === null) continue;
    const item = m as Record<string, unknown>;
    const category = item.MediaCategory;
    if (typeof category === "string" && category.toLowerCase() !== "photo") continue;
    const url = item.MediaURL;
    if (typeof url !== "string" || !/^https:\/\/[^\s"'<>]+$/i.test(url)) continue;
    const order = typeof item.Order === "number" && Number.isFinite(item.Order) ? item.Order : Infinity;
    // Estricto: ante el mismo Order gana el primero del arreglo.
    if (bestUrl === null || order < bestOrder) {
      bestUrl = url;
      bestOrder = order;
    }
  }
  return bestUrl;
}

function photoAlt(city: string | null, lang: Locale): string {
  if (lang === "es") return city ? `Propiedad en venta en ${city}` : "Propiedad en venta";
  return city ? `Home for sale in ${city}` : "Home for sale";
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
      photoUrl: primaryMlsPhotoUrl(row.media),
      photoAlt: photoAlt(row.city, lang),
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
 * fallaría el cruce y la propiedad saldría duplicada. La definición vive junto al
 * validador del panel de admin para que escribir y cruzar usen la MISMA regla.
 */
export { normalizeMlsNumber };

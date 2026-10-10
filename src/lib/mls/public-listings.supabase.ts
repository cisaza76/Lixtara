// Lectura del inventario público del MLS para las páginas SSR.
//
// Cliente SERVICE-ROLE porque `mls_listings` tiene RLS deny-all — a propósito: si fuera
// legible por `anon`, cualquiera podría paginar el feed entero vía PostgREST, que es lo
// que prohíbe el Schedule A §6. El servidor lee y renderiza; los bytes nunca salen por
// una API propia.
//
// FAIL-SOFT: si el gate niega o la consulta falla, se devuelve vacío y la página muestra
// solo los listings propios. Una página pública no puede caerse porque el feed de un
// tercero tenga un mal día.
import { headers } from "next/headers";
import { createService } from "@/lib/supabase/service";
import type { Locale } from "@/lib/i18n";
import { mlsDisplayDecision, readMlsGateEnv } from "@/lib/mls/environment-gate";
import {
  mergePublicListings,
  type MlsPublicListing,
  type MlsPublicRow,
  type OwnListingRef,
} from "@/lib/mls/public-listings";
import { PUBLICLY_DISPLAYABLE_STATUSES } from "@/lib/mls/display-compliance";
import { PAGE_SIZE, parsePropertySearch, type PropertySearch } from "@/lib/property-search";

const COLUMNAS =
  "listing_key,listing_id,mls_status,withdrawn_at,list_price,city,postal_code," +
  "list_office_name,list_agent_name,list_office_phone,list_office_email," +
  "list_agent_phone,list_agent_email," +
  // Solo el arreglo de fotos, no el payload entero: es lo único del payload que pinta la
  // tarjeta. Las URLs se usan por hot-link; nada se descarga.
  "media:payload->Media";

export interface PublicMlsResult {
  listings: MlsPublicListing[];
  /** false = el gate negó; la UI no debe mostrar avisos del MLS si no hay contenido suyo. */
  enabled: boolean;
  /** Fichas del feed que cumplen los filtros (antes de deduplicar). Para la paginación. */
  total: number;
}

/**
 * Listings de terceros para una página pública, ya deduplicados contra los propios.
 *
 * `own` lo aporta quien llama —ya tiene los listings propios cargados— para no consultar
 * `properties` dos veces.
 */
export async function getPublicMlsListings(
  own: OwnListingRef[],
  lang: Locale,
  search: PropertySearch = parsePropertySearch({}),
): Promise<PublicMlsResult> {
  // El host decide: un deployment de producción también responde en lixtara.vercel.app,
  // que el acuerdo NO nombra. Ver ADR-0013.
  const host = (await headers()).get("host");
  if (!mlsDisplayDecision(host, readMlsGateEnv()).allowed) {
    return { listings: [], enabled: false, total: 0 };
  }

  try {
    const db = createService();
    // Los filtros van sobre columnas propias e indexadas (migración 20261011120000), nunca
    // sobre `payload`: filtrar el jsonb obliga a descomprimir las ~50.000 filas.
    let q = db
      .from("mls_listings")
      .select(COLUMNAS, { count: "exact" })
      .is("withdrawn_at", null)
      .in("mls_status", [...PUBLICLY_DISPLAYABLE_STATUSES]);
    if (search.minPrice !== null) q = q.gte("list_price", search.minPrice);
    if (search.maxPrice !== null) q = q.lte("list_price", search.maxPrice);
    if (search.beds !== null) q = q.gte("bedrooms", search.beds);
    if (search.baths !== null) q = q.gte("bathrooms", search.baths);
    if (search.county !== null) q = q.eq("county_key", search.county);
    if (search.zip !== null) q = q.eq("postal_code", search.zip);

    q = search.sort === "newest"
      ? q.order("modification_ts", { ascending: false })
      : q.order("list_price", { ascending: search.sort === "price_asc", nullsFirst: false });
    // Desempate estable: sin él, dos fichas con el mismo precio pueden saltar de página.
    q = q.order("listing_key", { ascending: true });

    const from = (search.page - 1) * PAGE_SIZE;
    const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(JSON.stringify({ event: "mls_public_read_failed", message: error.message }));
      return { listings: [], enabled: true, total: 0 };
    }

    const { mlsListings } = mergePublicListings(
      own, (data ?? []) as unknown as MlsPublicRow[], lang);
    return { listings: mlsListings, enabled: true, total: count ?? mlsListings.length };
  } catch (e) {
    console.error(JSON.stringify({
      event: "mls_public_read_failed",
      message: e instanceof Error ? e.message : String(e),
    }));
    return { listings: [], enabled: true, total: 0 };
  }
}

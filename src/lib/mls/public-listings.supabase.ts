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

const COLUMNAS =
  "listing_key,listing_id,mls_status,withdrawn_at,list_price,city,postal_code," +
  "list_office_name,list_agent_name,list_office_phone,list_office_email," +
  "list_agent_phone,list_agent_email";

export interface PublicMlsResult {
  listings: MlsPublicListing[];
  /** false = el gate negó; la UI no debe mostrar avisos del MLS si no hay contenido suyo. */
  enabled: boolean;
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
  limit = 60,
): Promise<PublicMlsResult> {
  // El host decide: un deployment de producción también responde en lixtara.vercel.app,
  // que el acuerdo NO nombra. Ver ADR-0013.
  const host = (await headers()).get("host");
  if (!mlsDisplayDecision(host, readMlsGateEnv()).allowed) {
    return { listings: [], enabled: false };
  }

  try {
    const db = createService();
    const { data, error } = await db
      .from("mls_listings")
      .select(COLUMNAS)
      .is("withdrawn_at", null)
      .in("mls_status", [...PUBLICLY_DISPLAYABLE_STATUSES])
      .order("modification_ts", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(JSON.stringify({ event: "mls_public_read_failed", message: error.message }));
      return { listings: [], enabled: true };
    }

    const { mlsListings } = mergePublicListings(
      own, (data ?? []) as unknown as MlsPublicRow[], lang);
    return { listings: mlsListings, enabled: true };
  } catch (e) {
    console.error(JSON.stringify({
      event: "mls_public_read_failed",
      message: e instanceof Error ? e.message : String(e),
    }));
    return { listings: [], enabled: true };
  }
}

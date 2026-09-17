// Cobertura geográfica del feed IDX — qué listings se ingieren y cuáles se descartan.
//
// DECISIÓN DEL OWNER (2026-09-16): Miami-Dade, Broward y Palm Beach, en Florida. El feed
// de MIAMI trae Miami MLS **y Beaches MLS**, más listings globales fuera de área; todo lo
// que caiga fuera de esos tres condados se descarta.
//
// Base contractual: Schedule D §6.j permite excluir listings "based only on objective
// criteria, including ... factors such as geography". El criterio coincide con el ICP de
// Lixtara. Naples y Tampa quedan fuera a propósito: corren bajo Southwest Florida MLS y
// Stellar MLS, que son feeds DISTINTOS a este — integración aparte, no un filtro.
//
// DÓNDE SE APLICA: en el worker, al procesar cada listing, NO como `$filter` en la consulta
// a Bridge. El criterio vive en nuestro código y está testeado; delegarlo al proveedor lo
// haría invisible y no verificable.
//
// PURO: sin I/O.
import type { ResoListing } from "@/lib/mls/feed-port";

/**
 * Condados incluidos, en su forma legible. La comparación normaliza AMBOS lados con
 * `normalizeGeoName`, así que esta lista puede escribirse como la lee una persona sin
 * que se desincronice del normalizador — que fue exactamente el bug de la primera
 * versión: "Miami-Dade" normaliza a "miami dade" y la constante decía "miami-dade".
 */
export const SUPPORTED_COUNTIES = ["Miami-Dade", "Broward", "Palm Beach"] as const;
export const SUPPORTED_STATE = "FL";

/**
 * VERIFICADO contra la API real de Bridge el 2026-09-16 (dataset `test`, 20 registros):
 *   CountyOrParish   presente en 20/20   ← candidato primario, confirmado
 *   StateOrProvince  presente en 18/20   ← candidato primario, confirmado
 *   County / State   presentes en 0/20   ← no existen en Bridge; se conservan por si otro
 *                                          dataset los usara, sin coste
 *
 * ⚠️ La verificación se hizo contra el dataset `test` de Bridge, NO contra `miamire`, que
 * todavía devuelve 401 (acceso a los datos de MIAMI sin aprobar). Los nombres son RESO
 * estándar y Bridge los sirve así, pero conviene re-correr `pnpm mls:inspect-fields` con
 * MLS_BRIDGE_DATASET=miamire en cuanto el acceso esté vivo.
 */
export const COUNTY_FIELD_CANDIDATES = ["CountyOrParish", "County"] as const;
export const STATE_FIELD_CANDIDATES = ["StateOrProvince", "State"] as const;

/**
 * Normaliza un nombre de condado o estado para comparar: minúsculas, sin acentos, espacios
 * colapsados, y sin el sufijo "County" que algunos MLSs añaden.
 *
 * "Miami Dade" y "MIAMI-DADE COUNTY" tienen que caer en el mismo valor que "Miami-Dade";
 * una comparación literal dejaría fuera listings legítimos según cómo los teclee cada MLS.
 */
export function normalizeGeoName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const base = raw
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
  if (base.length === 0) return null;

  // Quitar el sufijo "county" SOLO si queda algo. Verificado contra el feed real: el
  // dataset `test` de Bridge trae `CountyOrParish: "County"` como valor de relleno, y
  // quitarlo a ciegas lo dejaba vacío → el campo parecía ausente y el filtro excluía todo.
  // Un condado real nunca se llama solo "County", pero la regla defensiva cuesta nada y
  // evita que un valor degenerado se confunda con un campo faltante.
  const sinSufijo = base.replace(/\bcounty\b/g, "").replace(/\s+/g, " ").trim();
  return sinSufijo.length > 0 ? sinSufijo : base;
}

/**
 * Conjuntos normalizados, derivados de las constantes legibles de arriba. Derivarlos —en
 * vez de escribirlos a mano— hace imposible que la lista y el normalizador se separen.
 */
const CONDADOS_NORMALIZADOS = new Set(
  SUPPORTED_COUNTIES.map((c) => normalizeGeoName(c)).filter((c): c is string => c !== null),
);
const ESTADOS_ACEPTADOS = new Set(
  [SUPPORTED_STATE, "Florida"].map((s) => normalizeGeoName(s)).filter((s): s is string => s !== null),
);

/** Lee el primer candidato presente. Devuelve también CUÁL se usó, para poder auditarlo. */
export function readCandidate(
  listing: ResoListing,
  candidates: readonly string[],
): { field: string; value: string } | null {
  for (const f of candidates) {
    const v = normalizeGeoName(listing[f]);
    if (v !== null) return { field: f, value: v };
  }
  return null;
}

export type CoverageVerdict =
  | { included: true; county: string; countyField: string }
  | { included: false; reason: CoverageExclusionReason; detail?: string };

export type CoverageExclusionReason =
  | "county_field_missing"   // ⚠️ probablemente el nombre del campo es otro — ver script
  | "state_not_supported"
  | "county_not_supported";

/**
 * ¿Este listing entra?
 *
 * FAIL-CLOSED: si no se puede determinar el condado, se EXCLUYE. Es el default seguro y,
 * además, el fallo ruidoso: si el nombre del campo resultara ser otro, TODO se excluye y
 * la búsqueda queda vacía — que se nota de inmediato. Lo contrario (incluir ante la duda)
 * metería inventario fuera de alcance de forma silenciosa.
 *
 * El estado solo se comprueba si el feed lo trae: es una salvaguarda extra, no un requisito.
 * Los tres condados son inequívocamente de Florida, así que el condado es el criterio.
 */
export function coverageVerdict(listing: ResoListing): CoverageVerdict {
  const estado = readCandidate(listing, STATE_FIELD_CANDIDATES);
  if (estado !== null && !ESTADOS_ACEPTADOS.has(estado.value)) {
    return { included: false, reason: "state_not_supported", detail: estado.value };
  }

  const condado = readCandidate(listing, COUNTY_FIELD_CANDIDATES);
  if (condado === null) {
    return { included: false, reason: "county_field_missing" };
  }

  if (!CONDADOS_NORMALIZADOS.has(condado.value)) {
    return { included: false, reason: "county_not_supported", detail: condado.value };
  }

  return { included: true, county: condado.value, countyField: condado.field };
}

export function isWithinCoverage(listing: ResoListing): boolean {
  return coverageVerdict(listing).included;
}

/**
 * Reparte una página en incluidos y excluidos, con el conteo por motivo.
 *
 * El conteo NO es decorativo: si `county_field_missing` domina, el nombre del campo está
 * mal y hay que correr el script de inspección. El worker lo registra en cada pasada.
 */
export function partitionByCoverage(listings: ResoListing[]): {
  included: ResoListing[];
  excluded: Array<{ listing: ResoListing; reason: CoverageExclusionReason; detail?: string }>;
  counts: Record<CoverageExclusionReason | "included", number>;
} {
  const included: ResoListing[] = [];
  const excluded: Array<{ listing: ResoListing; reason: CoverageExclusionReason; detail?: string }> = [];
  const counts = {
    included: 0,
    county_field_missing: 0,
    state_not_supported: 0,
    county_not_supported: 0,
  };

  for (const l of listings) {
    const v = coverageVerdict(l);
    if (v.included) {
      included.push(l);
      counts.included += 1;
    } else {
      excluded.push({ listing: l, reason: v.reason, detail: v.detail });
      counts[v.reason] += 1;
    }
  }
  return { included, excluded, counts };
}

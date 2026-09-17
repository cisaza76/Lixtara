// Puerto del feed del MLS — Seam entre "de dónde vienen los listings" y todo lo demás.
//
// Mismo patrón que StoragePort (video-engine/storage-port.ts) y RenderProvider: interfaz
// pura, adaptador real detrás, fake en los tests. El motivo no es estético: el plan
// documentado contempla sumar **Stellar MLS** para Tampa/Orlando, que corre sobre la misma
// plataforma Matrix/CoreLogic. Con este puerto eso es un archivo nuevo; sin él, una
// reescritura.
//
// PURO: sin red, sin I/O, sin Date.now(). El adaptador de Bridge vive aparte.
//
// § III.B.4 — todo lo que sale de este puerto viene marcado como `MlsLicensed<T>`, así que
// no puede alcanzar una superficie de IA sin un error de compilación. La marca se aplica
// aquí, en el ÚNICO punto por el que entra el contenido licenciado.
import type { MlsLicensed } from "@/lib/mls/licensed-content";

/**
 * Subconjunto del RESO Data Dictionary del que dependemos. NO es el payload completo —
 * el payload crudo se guarda entero en `mls_listings.payload` y sigue siendo la fuente de
 * verdad. Esto es lo que el código lee por nombre.
 *
 * Todo opcional salvo las tres claves: un MLS puede no publicar un campo, y un campo
 * ausente NO es un error de sincronización.
 */
export interface ResoListing {
  /** Identificador estable e inmutable. Clave primaria del almacenamiento. */
  ListingKey: string;
  /** El "número de MLS" visible. Clave del cruce con properties.mls_number. */
  ListingId: string;
  /** StandardStatus de RESO: Active, Active Under Contract, Pending, Closed, … */
  StandardStatus: string;
  ModificationTimestamp?: string;
  ListPrice?: number;
  City?: string;
  PostalCode?: string;
  Latitude?: number;
  Longitude?: number;
  ListOfficeName?: string;
  ListOfficePhone?: string;
  ListOfficeEmail?: string;
  ListAgentFullName?: string;
  ListAgentPreferredPhone?: string;
  ListAgentEmail?: string;
  /** Campos que no modelamos. Viajan al payload sin tocarse. */
  [key: string]: unknown;
}

export interface MlsFeedPage {
  listings: MlsLicensed<ResoListing>[];
  /**
   * Cursor OPACO del proveedor — el enlace `next` de Bridge, sin interpretar. Que sea
   * opaco es deliberado: otro proveedor pagina distinto y no queremos que el worker lo
   * sepa. `null` = no hay más páginas.
   */
  nextCursor: string | null;
}

export interface MlsFeedProvider {
  /** Identifica el dataset. Es la PK de `mls_sync_state`. */
  readonly dataset: string;
  /**
   * Página de listings modificados DESPUÉS de `since`.
   *
   * EL ORDEN NO ESTÁ GARANTIZADO. El primer diseño lo exigía ascendente, pero el endpoint
   * /replication de Bridge devuelve `400 "$orderby is not supported on this endpoint"`
   * (verificado 2026-09-16). Un proveedor PUEDE ordenar; ningún consumidor puede asumirlo.
   *
   * Consecuencia para quien consuma este puerto: el cursor de reanudación es `nextCursor`,
   * y `last_modification_ts` solo puede avanzar cuando la pasada COMPLETA termina — ver
   * SYNC_CURSOR_POLICY en bridge-adapter.ts.
   *
   * `since = null` → carga inicial completa.
   * `cursor` no nulo → continuar esa paginación; `since` se ignora.
   */
  fetchModifiedSince(since: Date | null, cursor: string | null): Promise<MlsFeedPage>;
}

// ── Normalización ───────────────────────────────────────────────────────────────────
// Del payload RESO a las columnas proyectadas. Lógica pura y testeable: es donde se
// concentran las diferencias entre MLSs y donde más fácil se cuela un error silencioso.

export interface NormalizedListing {
  listing_key: string;
  listing_id: string;
  mls_status: string;
  modification_ts: string;
  payload: ResoListing;
  list_price: number | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  list_office_name: string | null;
  list_office_phone: string | null;
  list_office_email: string | null;
  list_agent_name: string | null;
  list_agent_phone: string | null;
  list_agent_email: string | null;
}

export class MlsNormalizationError extends Error {
  readonly listingKey: string | undefined;
  constructor(message: string, listingKey?: string) {
    super(message);
    this.name = "MlsNormalizationError";
    this.listingKey = listingKey;
  }
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Normaliza una ficha RESO. Lanza solo si faltan las tres claves sin las que la fila no
 * puede existir; cualquier otro campo ausente es `null`, porque un MLS que no publica un
 * campo opcional no es un fallo de sincronización.
 *
 * `fallbackTimestamp` cubre el caso real de un MLS que omite ModificationTimestamp: sin
 * él la fila no se podría ordenar ni sería reanudable el cursor.
 */
export function normalizeListing(
  raw: ResoListing,
  fallbackTimestamp: string,
): NormalizedListing {
  const listing_key = str(raw.ListingKey);
  if (!listing_key) throw new MlsNormalizationError("ListingKey ausente o vacío");

  const listing_id = str(raw.ListingId);
  if (!listing_id) throw new MlsNormalizationError("ListingId ausente o vacío", listing_key);

  const mls_status = str(raw.StandardStatus);
  if (!mls_status) {
    throw new MlsNormalizationError("StandardStatus ausente o vacío", listing_key);
  }

  return {
    listing_key,
    listing_id,
    mls_status,
    modification_ts: str(raw.ModificationTimestamp) ?? fallbackTimestamp,
    payload: raw,
    list_price: num(raw.ListPrice),
    city: str(raw.City),
    postal_code: str(raw.PostalCode),
    latitude: num(raw.Latitude),
    longitude: num(raw.Longitude),
    list_office_name: str(raw.ListOfficeName),
    list_office_phone: str(raw.ListOfficePhone),
    list_office_email: str(raw.ListOfficeEmail),
    list_agent_name: str(raw.ListAgentFullName),
    list_agent_phone: str(raw.ListAgentPreferredPhone),
    list_agent_email: str(raw.ListAgentEmail),
  };
}

/**
 * Máximo ModificationTimestamp de una página — el valor al que avanza el cursor.
 * Devuelve null si la página viene vacía (no hay nada que avanzar).
 */
export function maxModificationTimestamp(listings: NormalizedListing[]): string | null {
  let max: string | null = null;
  for (const l of listings) {
    if (max === null || l.modification_ts > max) max = l.modification_ts;
  }
  return max;
}

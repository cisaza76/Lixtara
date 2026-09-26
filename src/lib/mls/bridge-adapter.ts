// Adaptador de Bridge Data Output para el puerto MlsFeedProvider.
//
// VERIFICADO PARCIALMENTE contra la API real el 2026-09-16, usando el dataset `test` de
// Bridge: base, ruta /replication, auth Bearer, paginación por `$next` y soporte de
// `$filter` están confirmados; `$orderby` está confirmado como NO soportado. Lo que NO
// está verificado es el dataset `miamire`, que aún devuelve 401 — el acceso a los datos
// de MIAMI no está aprobado todavía.
//
// El diseño acota el daño de equivocarse: si la forma difiere, cambia ESTE archivo y nada
// más — el puerto, el normalizador, el filtro de cobertura y el worker no se enteran.
import { requireMlsServerToken } from "@/lib/mls/environment-gate";
import { markAsMlsLicensed } from "@/lib/mls/licensed-content";
import type {
  MlsFeedPage, MlsFeedProvider, MlsKeyPage, ResoKeyRecord, ResoListing,
} from "@/lib/mls/feed-port";
import { PUBLICLY_DISPLAYABLE_STATUSES } from "@/lib/mls/display-compliance";
import { SUPPORTED_PROPERTY_TYPES } from "@/lib/mls/coverage";

/** VERIFICADO: base de la Web API v2 de Bridge. */
export const BRIDGE_API_BASE = "https://api.bridgedataoutput.com/api/v2/OData";

/**
 * VERIFICADO: `/replication` responde y pagina. Frente al endpoint OData normal admite
 * páginas mucho mayores, y es el que Bridge documenta para sincronización incremental.
 * A cambio no ordena — ver SYNC_CURSOR_POLICY.
 */
export const BRIDGE_REPLICATION_PAGE_SIZE = 200;

/**
 * VERIFICADO (2026-09-26, dataset `test`): el `$top` máximo de `/replication` es 2.000;
 * con 2.001 responde `400 "Maximum value for $top is 2000"`. Las consultas de SOLO CLAVES
 * lo usan: cada registro son unos pocos campos, así que una página de 2.000 pesa menos
 * que una de 200 fichas completas.
 */
export const BRIDGE_REPLICATION_MAX_TOP = 2000;

/** Campos de una consulta de bajas: lo justo para auditar por qué se borra. */
export const REMOVED_KEYS_SELECT = ["ListingKey", "StandardStatus", "PropertyType"] as const;

/**
 * Campos de la reconciliación: la clave más lo que lee `coverageVerdict`. Solo los
 * nombres VERIFICADOS en Bridge (CountyOrParish, StateOrProvince): `$select` de un campo
 * inexistente podría responder 400 y tumbar la reconciliación entera.
 */
export const DISPLAYABLE_KEYS_SELECT = [
  "ListingKey", "StandardStatus", "PropertyType", "CountyOrParish", "StateOrProvince",
] as const;

export interface BridgeAdapterOptions {
  /** Identificador del dataset en Bridge (p. ej. el de MIAMI). */
  dataset: string;
  /** Inyectable para tests; por defecto `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  pageSize?: number;
  /** Inyectable para tests; por defecto lee la credencial detrás del gate de entorno. */
  tokenProvider?: () => string;
}

export class BridgeFeedError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BridgeFeedError";
    this.status = status;
  }
}

/** Forma de la respuesta, verificada contra el dataset `test`. */
interface BridgeResponse {
  value?: unknown;
  "@odata.nextLink"?: unknown;
  /** Bridge documenta un enlace "next"; se aceptan ambas grafías. */
  nextLink?: unknown;
}

export function createBridgeProvider(opts: BridgeAdapterOptions): MlsFeedProvider {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const pageSize = opts.pageSize ?? BRIDGE_REPLICATION_PAGE_SIZE;
  // La credencial se obtiene SOLO a través del gate: `requireMlsServerToken` verifica
  // producción + flag antes de devolverla, así que un preview no puede llamar a Bridge
  // ni con la variable puesta por error.
  const getToken = opts.tokenProvider ?? requireMlsServerToken;

  /** Pide una página y devuelve el arreglo crudo y el enlace siguiente. */
  async function fetchPage(url: string): Promise<{ value: unknown[]; nextCursor: string | null }> {
    const token = getToken();
    const res = await doFetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      // Nunca se incluye el cuerpo ni la URL en el mensaje: la URL lleva el dataset y
      // podría llevar el token según cómo Bridge acepte la auth.
      throw new BridgeFeedError(
        `Bridge respondió ${res.status} al leer el feed`,
        res.status,
      );
    }

    const body = (await res.json()) as BridgeResponse;
    const value = body.value;
    if (!Array.isArray(value)) {
      throw new BridgeFeedError("Respuesta de Bridge sin arreglo `value`");
    }

    const next = body["@odata.nextLink"] ?? body.nextLink;
    return { value, nextCursor: typeof next === "string" && next.length > 0 ? next : null };
  }

  /** Solo registros con ListingKey utilizable; el resto no se puede borrar ni confirmar. */
  function toKeyPage(p: { value: unknown[]; nextCursor: string | null }): MlsKeyPage {
    return {
      keys: p.value
        .filter((k): k is ResoKeyRecord =>
          typeof k === "object" && k !== null &&
          typeof (k as ResoKeyRecord).ListingKey === "string" &&
          (k as ResoKeyRecord).ListingKey.trim().length > 0)
        .map((k) => markAsMlsLicensed(k)),
      nextCursor: p.nextCursor,
    };
  }

  return {
    dataset: opts.dataset,

    async fetchModifiedSince(since: Date | null, cursor: string | null): Promise<MlsFeedPage> {
      // Un cursor es un enlace completo que devolvió Bridge: se sigue tal cual, sin
      // reconstruirlo. Reconstruirlo es como se pierden registros entre páginas.
      const p = await fetchPage(cursor ?? buildReplicationUrl(opts.dataset, since, pageSize));
      return {
        // La marca se aplica AQUÍ: es el punto por el que entra el contenido licenciado
        // al sistema, así que todo lo que salga queda teñido (ADR-0014).
        listings: p.value.map((l) => markAsMlsLicensed(l as ResoListing)),
        nextCursor: p.nextCursor,
      };
    },

    async fetchRemovedKeysSince(since: Date, cursor: string | null): Promise<MlsKeyPage> {
      return toKeyPage(await fetchPage(
        cursor ?? buildRemovedKeysUrl(opts.dataset, since, BRIDGE_REPLICATION_MAX_TOP)));
    },

    async fetchDisplayableKeys(cursor: string | null): Promise<MlsKeyPage> {
      return toKeyPage(await fetchPage(
        cursor ?? buildDisplayableKeysUrl(opts.dataset, BRIDGE_REPLICATION_MAX_TOP)));
    },
  };
}

/**
 * Construye la URL de la primera página.
 *
 * VERIFICADO contra la API real (2026-09-16, dataset `test`):
 *   - `/replication` responde 200 y pagina con `$next=` en el nextLink.
 *   - `$filter` sobre ModificationTimestamp FUNCIONA — es lo que hace posible el
 *     incremental.
 *   - **`$orderby` NO está soportado en este endpoint**: devuelve
 *     `400 "$orderby is not supported on this endpoint"`.
 *
 * Ese último punto invalidó el diseño original, que avanzaba el cursor al máximo de cada
 * página asumiendo orden ascendente. Sin orden garantizado eso perdería registros. La
 * estrategia correcta —y de hecho más robusta— es la contraria: paginar la pasada COMPLETA
 * con el nextLink y avanzar `last_modification_ts` SOLO cuando la pasada termina. Ver
 * `SYNC_CURSOR_POLICY`.
 */
export function buildReplicationUrl(
  dataset: string,
  since: Date | null,
  pageSize: number,
): string {
  const url = new URL(`${BRIDGE_API_BASE}/${dataset}/Property/replication`);
  url.searchParams.set("$top", String(pageSize));

  const clausulas = [ingestableStatusFilter(), ingestablePropertyTypeFilter()];
  if (since) clausulas.push(`ModificationTimestamp gt ${since.toISOString()}`);
  url.searchParams.set("$filter", clausulas.join(" and "));

  return url.toString();
}

/**
 * Consulta de BAJAS del incremental: claves modificadas después de `since` cuyo estado o
 * tipo ya NO es mostrable. Complementa a `buildReplicationUrl`, que por filtrar estado y
 * tipo nunca vuelve a ver una ficha que pasó a Closed / Expired / Withdrawn.
 *
 * Solo `$select` de claves: el payload de una ficha no mostrable jamás se descarga.
 *
 * NEGACIÓN — VERIFICADO contra Bridge (2026-09-26, dataset `test`): `ne`, `not (…)` e
 * `in (…)` responden 200 y filtran igual. Se usa `ne` encadenado con `and`/`or`:
 *   - es la misma familia de operadores que el filtro positivo (`eq` + `or`), el que ya
 *     está probado contra `miamire`;
 *   - VERIFICADO que `PropertyType ne 'X'` DEVUELVE los registros con el campo en null
 *     (33 de 2.000 en `test`). Es lo correcto aquí: una ficha sin tipo tampoco es
 *     mostrable (coverageVerdict la excluye), así que debe salir.
 */
export function buildRemovedKeysUrl(dataset: string, since: Date, pageSize: number): string {
  const url = new URL(`${BRIDGE_API_BASE}/${dataset}/Property/replication`);
  url.searchParams.set("$top", String(pageSize));
  url.searchParams.set("$select", REMOVED_KEYS_SELECT.join(","));
  url.searchParams.set(
    "$filter",
    `ModificationTimestamp gt ${since.toISOString()} and ` +
      `(${nonDisplayableStatusFilter()} or ${nonIngestablePropertyTypeFilter()})`,
  );
  return url.toString();
}

/**
 * Universo mostrable, SOLO CLAVES + campos de cobertura, para la reconciliación. Mismos
 * filtros de estado y tipo que la ingesta y SIN filtro de condado: la cobertura se
 * decide en nuestro código (decisión del owner), igual que en la ingesta.
 */
export function buildDisplayableKeysUrl(dataset: string, pageSize: number): string {
  const url = new URL(`${BRIDGE_API_BASE}/${dataset}/Property/replication`);
  url.searchParams.set("$top", String(pageSize));
  url.searchParams.set("$select", DISPLAYABLE_KEYS_SELECT.join(","));
  url.searchParams.set(
    "$filter",
    [ingestableStatusFilter(), ingestablePropertyTypeFilter()].join(" and "),
  );
  return url.toString();
}

/** Negación del filtro de estado: ningún estado mostrable (incluye StandardStatus null). */
export function nonDisplayableStatusFilter(): string {
  return `(${PUBLICLY_DISPLAYABLE_STATUSES.map((s) => `StandardStatus ne '${s}'`).join(" and ")})`;
}

/** Negación del filtro de tipo: ningún tipo ingerible (incluye PropertyType null). */
export function nonIngestablePropertyTypeFilter(): string {
  return `(${SUPPORTED_PROPERTY_TYPES.map((t) => `PropertyType ne '${t}'`).join(" and ")})`;
}

/**
 * Filtro de ESTADO en la consulta. Distinto del de cobertura geográfica, que por decisión
 * del owner vive en nuestro código y no aquí.
 *
 * Medido contra el feed real de MIAMI el 2026-09-18:
 *   total del feed          1.438.500
 *   Closed (7 años)         1.327.107   = 92% del feed
 *   4 estados públicos × 3 condados 93.980
 *
 * Descargar el 92% para descartarlo en memoria no es solo derroche: § III.B.9 prohíbe
 * "download ... any of the Licensed Content ... except Participant's Website", y bajarse
 * 1,3 M de fichas que jamás se exhiben es difícil de defender como exhibición.
 *
 * Los datos de venta cerrada SÍ hacen falta para los comparables del vendedor, pero ese
 * caso pide una consulta BAJO DEMANDA —ventas cercanas a una dirección concreta en los
 * últimos N meses— y no replicar 1,3 M de filas con su carga de purga bajo § VI.C.
 */
/**
 * Filtro de TIPO en la consulta. La AUTORIDAD sigue siendo `coverageVerdict` en nuestro
 * código —igual que el filtro de condado, y por la misma razón: el criterio debe estar
 * testeado y ser auditable—. Esto es una optimización encima, no un reemplazo.
 *
 * Vale la pena porque el 56,9 % de lo que bajaríamos se descarta: alquileres 26,2 %,
 * terrenos 12,5 %, comercial 14,2 %, resto 4 %. Y si Bridge cambiara el comportamiento de
 * `$filter`, el filtro de código sigue protegiendo la tabla — que es justo lo que pidió el
 * owner al exigir que la ingesta no acumule filas que nunca se muestran.
 */
export function ingestablePropertyTypeFilter(): string {
  return SUPPORTED_PROPERTY_TYPES
    .map((t) => `PropertyType eq '${t}'`)
    .join(" or ")
    .replace(/^(.*)$/, "($1)");
}

export function ingestableStatusFilter(): string {
  return PUBLICLY_DISPLAYABLE_STATUSES
    .map((s) => `StandardStatus eq '${s}'`)
    .join(" or ")
    .replace(/^(.*)$/, "($1)");
}

/**
 * Política del cursor, documentada aquí porque nace de una restricción de la API y no de
 * una preferencia de diseño.
 *
 * `/replication` no ordena, así que dentro de una pasada NO se puede saber si ya se vio
 * todo lo anterior a un timestamp dado. Por tanto:
 *
 *   1. Al empezar la pasada, se anota `passStartedAt` (y se persiste si se interrumpe).
 *   2. Se pagina TODO con el nextLink, filtrando por `ModificationTimestamp gt {since}`,
 *      y después la consulta de bajas con el mismo `since`.
 *   3. Solo si la pasada COMPLETA termina, `last_modification_ts = passStartedAt`.
 *   4. Si se interrumpe, la siguiente invocación continúa con el cursor guardado. El
 *      upsert por listing_key hace que repetir una página sea inocuo.
 *
 * Se avanza a `passStartedAt` y no al máximo visto: un registro modificado DURANTE la
 * pasada puede haber aparecido en una página temprana, y usar el máximo lo saltaría. El
 * solapamiento que produce `runStartedAt` se reprocesa sin consecuencias.
 */
export const SYNC_CURSOR_POLICY = {
  advanceOnlyOnCompleteRun: true,
  // El inicio de la PASADA, no de la invocación que la termina: una pasada que cruza
  // varias invocaciones que avanzara al inicio de la última saltaría todo lo modificado
  // entre la primera y la última.
  advanceTo: "passStartedAt",
} as const;

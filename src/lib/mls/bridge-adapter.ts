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
import type { MlsFeedPage, MlsFeedProvider, ResoListing } from "@/lib/mls/feed-port";
import { PUBLICLY_DISPLAYABLE_STATUSES } from "@/lib/mls/display-compliance";

/** VERIFICADO: base de la Web API v2 de Bridge. */
export const BRIDGE_API_BASE = "https://api.bridgedataoutput.com/api/v2/OData";

/**
 * VERIFICADO: `/replication` responde y pagina. Frente al endpoint OData normal admite
 * páginas mucho mayores, y es el que Bridge documenta para sincronización incremental.
 * A cambio no ordena — ver SYNC_CURSOR_POLICY.
 */
export const BRIDGE_REPLICATION_PAGE_SIZE = 200;

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

  return {
    dataset: opts.dataset,

    async fetchModifiedSince(since: Date | null, cursor: string | null): Promise<MlsFeedPage> {
      const token = getToken();

      // Un cursor es un enlace completo que devolvió Bridge: se sigue tal cual, sin
      // reconstruirlo. Reconstruirlo es como se pierden registros entre páginas.
      const url = cursor ?? buildReplicationUrl(opts.dataset, since, pageSize);

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
      return {
        // La marca se aplica AQUÍ: es el punto por el que entra el contenido licenciado
        // al sistema, así que todo lo que salga queda teñido (ADR-0014).
        listings: value.map((l) => markAsMlsLicensed(l as ResoListing)),
        nextCursor: typeof next === "string" && next.length > 0 ? next : null,
      };
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

  const clausulas = [ingestableStatusFilter()];
  if (since) clausulas.push(`ModificationTimestamp gt ${since.toISOString()}`);
  url.searchParams.set("$filter", clausulas.join(" and "));

  return url.toString();
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
 *   1. Al empezar, se anota `runStartedAt`.
 *   2. Se pagina TODO con el nextLink, filtrando por `ModificationTimestamp gt {since}`.
 *   3. Solo si la pasada COMPLETA termina, `last_modification_ts = runStartedAt`.
 *   4. Si se interrumpe, la siguiente pasada repite desde el mismo `since`. El upsert por
 *      listing_key hace que repetir sea inocuo.
 *
 * Se avanza a `runStartedAt` y no al máximo visto: un registro modificado DURANTE la
 * pasada puede haber aparecido en una página temprana, y usar el máximo lo saltaría. El
 * solapamiento que produce `runStartedAt` se reprocesa sin consecuencias.
 */
export const SYNC_CURSOR_POLICY = {
  advanceOnlyOnCompleteRun: true,
  advanceTo: "runStartedAt",
} as const;

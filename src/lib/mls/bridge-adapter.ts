// Adaptador de Bridge Data Output para el puerto MlsFeedProvider.
//
// ⚠️ NO VERIFICADO CONTRA LA API REAL. La documentación de Bridge
// (bridgedataoutput.com/docs) es una SPA que no sirve contenido a un fetch, así que la
// forma de abajo viene de fuentes secundarias. Todo lo marcado con [SIN VERIFICAR] debe
// confirmarse en cuanto existan credenciales; `scripts/inspect-bridge-fields.ts` hace
// exactamente eso contra el feed real.
//
// El diseño acota el daño de equivocarse: si la forma difiere, cambia ESTE archivo y nada
// más — el puerto, el normalizador, el filtro de cobertura y el worker no se enteran.
import { requireMlsServerToken } from "@/lib/mls/environment-gate";
import { markAsMlsLicensed } from "@/lib/mls/licensed-content";
import type { MlsFeedPage, MlsFeedProvider, ResoListing } from "@/lib/mls/feed-port";

/** [SIN VERIFICAR] Base documentada de la Web API v2 de Bridge. */
export const BRIDGE_API_BASE = "https://api.bridgedataoutput.com/api/v2/OData";

/**
 * [SIN VERIFICAR] `/replication` frente al endpoint OData normal: soporta `$top` hasta
 * 2.000 por página contra 200 del normal, y es el que Bridge documenta para sincronización
 * incremental — que es exactamente nuestro caso.
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

/** Forma [SIN VERIFICAR] de la respuesta OData de Bridge. */
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
 * Construye la URL de la primera página. [SIN VERIFICAR] contra la API real.
 *
 * El orden ascendente por ModificationTimestamp NO es opcional: es lo que permite avanzar
 * el cursor al máximo de cada página y reanudar sin perder registros si el worker se queda
 * sin presupuesto a mitad.
 */
export function buildReplicationUrl(
  dataset: string,
  since: Date | null,
  pageSize: number,
): string {
  const url = new URL(`${BRIDGE_API_BASE}/${dataset}/Property/replication`);
  url.searchParams.set("$orderby", "ModificationTimestamp asc");
  url.searchParams.set("$top", String(pageSize));
  if (since) {
    url.searchParams.set("$filter", `ModificationTimestamp gt ${since.toISOString()}`);
  }
  return url.toString();
}

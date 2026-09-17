// Motor de sincronización del feed IDX. Lógica PURA con dependencias inyectadas: el
// store, el proveedor y el reloj entran por parámetro, así que cada camino se prueba sin
// red y sin base de datos. Mismo patrón que `runWorker` del worker de video.
//
// LA POLÍTICA DEL CURSOR NACE DE UNA RESTRICCIÓN DE LA API, NO DE UNA PREFERENCIA.
// `/replication` de Bridge no soporta `$orderby` (verificado: devuelve 400), así que
// dentro de una pasada NO se puede saber si ya se vio todo lo anterior a un timestamp.
// Por tanto `last_modification_ts` solo avanza cuando la pasada COMPLETA termina, y
// avanza a `runStartedAt` — no al máximo visto, que saltaría registros modificados
// durante la pasada. Ver SYNC_CURSOR_POLICY en bridge-adapter.ts.
import type { MlsFeedProvider, NormalizedListing } from "@/lib/mls/feed-port";
import { normalizeListing, MlsNormalizationError } from "@/lib/mls/feed-port";
import { partitionByCoverage, type CoverageExclusionReason } from "@/lib/mls/coverage";

export interface SyncState {
  dataset: string;
  lastModificationTs: string | null;
}

export interface SyncStore {
  readState(dataset: string): Promise<SyncState | null>;
  /** Upsert por listing_key. Idempotente: repetir una página no duplica. */
  upsertListings(rows: NormalizedListing[]): Promise<number>;
  /**
   * Avanza el cursor. SOLO se llama tras una pasada completa — el motor no expone otra
   * forma de moverlo, para que la política no dependa de la disciplina de quien llame.
   */
  commitCursor(dataset: string, lastModificationTs: string, recordsSeen: number): Promise<void>;
  /** Registra el resultado aunque la pasada no termine, para diagnóstico. */
  recordRun(dataset: string, status: "ok" | "partial" | "failed", error: string | null): Promise<void>;
}

export interface SyncDeps {
  provider: MlsFeedProvider;
  store: SyncStore;
  now(): number;
  /** Presupuesto de reloj para una invocación del cron. */
  timeBudgetMs: number;
  /** Tope de páginas por invocación — cinturón además del presupuesto. */
  maxPages: number;
}

export interface SyncSummary {
  dataset: string;
  /** true = se paginó hasta el final; es la ÚNICA condición que mueve el cursor. */
  completed: boolean;
  pages: number;
  received: number;
  upserted: number;
  excluded: Record<CoverageExclusionReason, number>;
  /** Fichas que no se pudieron normalizar. No abortan la pasada. */
  malformed: number;
  stoppedBy: "completed" | "time_budget" | "max_pages" | "error";
  error: string | null;
}

const vacío = (): Record<CoverageExclusionReason, number> => ({
  county_field_missing: 0,
  state_not_supported: 0,
  county_not_supported: 0,
});

export async function runMlsSync(deps: SyncDeps): Promise<SyncSummary> {
  const { provider, store, now, timeBudgetMs, maxPages } = deps;
  const dataset = provider.dataset;
  const runStartedAtMs = now();
  const runStartedAt = new Date(runStartedAtMs).toISOString();

  const estado = await store.readState(dataset);
  const since = estado?.lastModificationTs ? new Date(estado.lastModificationTs) : null;

  const resumen: SyncSummary = {
    dataset, completed: false, pages: 0, received: 0, upserted: 0,
    excluded: vacío(), malformed: 0, stoppedBy: "completed", error: null,
  };

  let cursor: string | null = null;
  try {
    for (;;) {
      if (now() - runStartedAtMs >= timeBudgetMs) { resumen.stoppedBy = "time_budget"; break; }
      if (resumen.pages >= maxPages) { resumen.stoppedBy = "max_pages"; break; }

      const pagina = await provider.fetchModifiedSince(since, cursor);
      resumen.pages += 1;
      resumen.received += pagina.listings.length;

      // El filtro de cobertura corre AQUÍ, en nuestro código, no como $filter en la
      // consulta: el criterio queda testeado y auditable en vez de delegado al proveedor.
      const { included, counts } = partitionByCoverage(pagina.listings);
      for (const k of Object.keys(resumen.excluded) as CoverageExclusionReason[]) {
        resumen.excluded[k] += counts[k];
      }

      // Una ficha malformada se salta; no puede tumbar la página entera. El conteo sube
      // para que un problema sistemático sea visible en el resumen.
      const filas: NormalizedListing[] = [];
      for (const l of included) {
        try {
          filas.push(normalizeListing(l, runStartedAt));
        } catch (e) {
          if (e instanceof MlsNormalizationError) resumen.malformed += 1;
          else throw e;
        }
      }

      if (filas.length > 0) resumen.upserted += await store.upsertListings(filas);

      cursor = pagina.nextCursor;
      if (cursor === null) { resumen.completed = true; resumen.stoppedBy = "completed"; break; }
    }
  } catch (e) {
    resumen.stoppedBy = "error";
    resumen.error = e instanceof Error ? e.message : String(e);
  }

  if (resumen.completed) {
    // Solo aquí. Una pasada incompleta deja el cursor donde estaba, así que la próxima
    // repite desde el mismo `since` — inocuo porque el upsert va por listing_key.
    await store.commitCursor(dataset, runStartedAt, resumen.received);
    await store.recordRun(dataset, "ok", null);
  } else {
    await store.recordRun(dataset, resumen.stoppedBy === "error" ? "failed" : "partial", resumen.error);
  }

  return resumen;
}

/**
 * ¿El resumen merece atención de un operador?
 *
 * `county_field_missing` dominante es la señal de que el nombre del campo de condado no es
 * el que asumimos — el fallo que el filtro fail-closed convierte en "búsqueda vacía" en vez
 * de en "datos fuera de alcance". Se detecta por proporción, no por conteo: 3 de 5 importa,
 * 3 de 5.000 no.
 */
export function syncNeedsAttention(s: SyncSummary): { attention: boolean; reason?: string } {
  if (s.error) return { attention: true, reason: `sync falló: ${s.error}` };
  if (s.received > 0 && s.excluded.county_field_missing / s.received > 0.5) {
    return {
      attention: true,
      reason: "más de la mitad de las fichas no traen condado determinable — revisar " +
              "COUNTY_FIELD_CANDIDATES con `pnpm mls:inspect-fields`",
    };
  }
  if (s.received > 0 && s.malformed / s.received > 0.1) {
    return { attention: true, reason: `${s.malformed}/${s.received} fichas malformadas` };
  }
  return { attention: false };
}

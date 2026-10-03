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
//
// DOS FASES POR PASADA INCREMENTAL:
//   1. `listings` — fichas mostrables modificadas (payload completo, filtradas).
//   2. `removals` — SOLO CLAVES de fichas modificadas que ya NO son mostrables (Closed,
//      Expired, Withdrawn, cambio de tipo). Se borran de mls_listings. Sin esta fase, una
//      ficha que deja de ser mostrable deja de llegar por (1) y quedaría "Active" para
//      siempre. Ver `fetchRemovedKeysSince`.
// Lo que ninguna de las dos ve —una ficha ELIMINADA del feed— lo cubre la reconciliación
// diaria (reconcile-run.ts).
import type { MlsFeedProvider, NormalizedListing } from "@/lib/mls/feed-port";
import { normalizeListing, MlsNormalizationError } from "@/lib/mls/feed-port";
import { partitionByCoverage, type CoverageExclusionReason } from "@/lib/mls/coverage";

export type SyncPassPhase = "listings" | "removals";

export interface SyncState {
  dataset: string;
  lastModificationTs: string | null;
  /**
   * Inicio de la pasada EN CURSO; null = no hay pasada a medias. Es el valor al que
   * avanza `lastModificationTs` cuando la pasada termina, aunque cruce varias
   * invocaciones.
   */
  passStartedAt: string | null;
  /** Fase de la pasada en curso. Sin pasada en curso se ignora. */
  passPhase: SyncPassPhase;
  /** nextLink opaco de la fase `listings` interrumpida. null = desde el principio. */
  resumeCursor: string | null;
  /** nextLink opaco de la fase `removals` interrumpida. null = desde el principio. */
  removalCursor: string | null;
}

/** Dónde quedó una pasada interrumpida. */
export interface SyncProgress {
  passStartedAt: string;
  passPhase: SyncPassPhase;
  resumeCursor: string | null;
  removalCursor: string | null;
}

export interface SyncStore {
  readState(dataset: string): Promise<SyncState | null>;
  /** Upsert por listing_key. Idempotente: repetir una página no duplica. */
  upsertListings(rows: NormalizedListing[]): Promise<number>;
  /**
   * BORRADO FÍSICO por listing_key; devuelve cuántas filas existían. Borrar una clave
   * que no está es un no-op, así que repetir una página es inocuo. Físico y no un
   * "oculto": una ficha no mostrable no tiene ningún uso permitido, y § VI.C obliga a
   * purgarla igualmente al terminar el acuerdo.
   */
  deleteListings(dataset: string, listingKeys: string[]): Promise<number>;
  /**
   * Avanza el cursor y LIMPIA el progreso de la pasada. Solo tras una pasada completa —
   * el motor no expone otra forma de moverlo, para que la política no dependa de la
   * disciplina de quien llame.
   */
  commitCursor(dataset: string, lastModificationTs: string, recordsSeen: number): Promise<void>;
  /**
   * Guarda dónde se quedó una pasada interrumpida. Sin esto, con 1,4 M de fichas en el
   * feed real, el worker reempezaría desde cero cada 6 h y no convergería jamás.
   */
  saveProgress(dataset: string, progress: SyncProgress): Promise<void>;
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
  /** true si esta invocación continuó una pasada interrumpida. */
  resumed: boolean;
  /** true = se paginó hasta el final (ambas fases); es la ÚNICA condición que mueve el cursor. */
  completed: boolean;
  /** Fase en la que terminó esta invocación. */
  phase: SyncPassPhase;
  pages: number;
  received: number;
  upserted: number;
  excluded: Record<CoverageExclusionReason, number>;
  /** Fichas que no se pudieron normalizar. No abortan la pasada. */
  malformed: number;
  /** Claves no mostrables devueltas por la consulta de bajas. */
  removalKeysReceived: number;
  /**
   * Filas BORRADAS de mls_listings en esta invocación: bajas (estado/tipo no mostrable)
   * más fichas que siguen en el feed pero ya caen fuera de cobertura.
   */
  removed: number;
  stoppedBy: "completed" | "time_budget" | "max_pages" | "error";
  error: string | null;
}

const vacío = (): Record<CoverageExclusionReason, number> => ({
  county_field_missing: 0,
  state_not_supported: 0,
  county_not_supported: 0,
  property_type_missing: 0,
  property_type_not_supported: 0,
});

export async function runMlsSync(deps: SyncDeps): Promise<SyncSummary> {
  const { provider, store, now, timeBudgetMs, maxPages } = deps;
  const dataset = provider.dataset;
  const runStartedAtMs = now();
  const runStartedAt = new Date(runStartedAtMs).toISOString();

  const estado = await store.readState(dataset);
  const since = estado?.lastModificationTs ? new Date(estado.lastModificationTs) : null;

  // ¿Hay una pasada a medias? `resumeCursor` sin `passStartedAt` es el estado que dejaba
  // la versión anterior del worker: se continúa igual, con el inicio de esta invocación.
  const enCurso = estado !== null &&
    (estado.passStartedAt !== null || estado.resumeCursor !== null || estado.removalCursor !== null);
  const passStartedAt = (enCurso && estado?.passStartedAt) || runStartedAt;
  let phase: SyncPassPhase = enCurso && estado ? estado.passPhase : "listings";
  let cursor: string | null = enCurso && phase === "listings" ? estado?.resumeCursor ?? null : null;
  let removalCursor: string | null = enCurso && phase === "removals" ? estado?.removalCursor ?? null : null;

  const resumen: SyncSummary = {
    dataset, resumed: enCurso, completed: false, phase, pages: 0, received: 0, upserted: 0,
    excluded: vacío(), malformed: 0, removalKeysReceived: 0, removed: 0,
    stoppedBy: "completed", error: null,
  };

  try {
    for (;;) {
      if (now() - runStartedAtMs >= timeBudgetMs) { resumen.stoppedBy = "time_budget"; break; }
      if (resumen.pages >= maxPages) { resumen.stoppedBy = "max_pages"; break; }

      if (phase === "listings") {
        const pagina = await provider.fetchModifiedSince(since, cursor);
        resumen.pages += 1;
        resumen.received += pagina.listings.length;

        // El filtro de cobertura corre AQUÍ, en nuestro código, no como $filter en la
        // consulta: el criterio queda testeado y auditable en vez de delegado al proveedor.
        const { included, excluded, counts } = partitionByCoverage(pagina.listings);
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

        // Una ficha que SIGUE en el feed con estado y tipo válidos pero que ahora cae
        // fuera de cobertura (p. ej. se corrigió el condado) no la ve la consulta de
        // bajas. Si estaba guardada, sale aquí. Casi todas nunca estuvieron: no-op.
        const fuera = excluded.map((e) => e.listing.ListingKey)
          .filter((k): k is string => typeof k === "string" && k.length > 0);
        if (fuera.length > 0) resumen.removed += await store.deleteListings(dataset, fuera);

        cursor = pagina.nextCursor;
        if (cursor === null) {
          // Carga inicial (`since` null): no hay nada guardado que dar de baja, y la
          // consulta de bajas sin `since` sería el 92 % del feed (los Closed).
          if (since === null) { resumen.completed = true; break; }
          phase = "removals";
          removalCursor = null;
        }
      } else {
        // `since` no es null aquí: la fase de bajas solo existe en incrementales.
        const pagina = await provider.fetchRemovedKeysSince(since as Date, removalCursor);
        resumen.pages += 1;
        resumen.removalKeysReceived += pagina.keys.length;

        const claves = pagina.keys.map((k) => k.ListingKey);
        if (claves.length > 0) resumen.removed += await store.deleteListings(dataset, claves);

        removalCursor = pagina.nextCursor;
        if (removalCursor === null) { resumen.completed = true; break; }
      }
    }
  } catch (e) {
    resumen.stoppedBy = "error";
    resumen.error = e instanceof Error ? e.message : String(e);
  }

  resumen.phase = phase;
  if (resumen.completed) {
    resumen.stoppedBy = "completed";
    // Solo aquí, y al inicio de la PASADA. commitCursor limpia también el progreso.
    await store.commitCursor(dataset, passStartedAt, resumen.received);
    await store.recordRun(dataset, "ok", null);
  } else {
    // Se persiste DÓNDE quedó para que la próxima invocación continúe en vez de
    // reempezar. `last_modification_ts` sigue sin moverse: la pasada no terminó.
    await store.saveProgress(dataset, {
      passStartedAt,
      passPhase: phase,
      resumeCursor: phase === "listings" ? cursor : null,
      removalCursor: phase === "removals" ? removalCursor : null,
    });
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

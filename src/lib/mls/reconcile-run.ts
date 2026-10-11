// Reconciliación diaria del feed IDX: detecta fichas ELIMINADAS del feed.
//
// Ningún incremental puede verlas: una ficha borrada no tiene ModificationTimestamp nuevo,
// simplemente deja de existir. La única forma de saberlo es pedir la lista completa del
// universo mostrable y comparar. Lógica PURA con dependencias inyectadas, mismo patrón que
// `runMlsSync`.
//
// CÓMO FUNCIONA, en varias invocaciones si hace falta:
//   1. Empieza: anota `startedAt`.
//   2. Pagina SOLO CLAVES del universo mostrable (mismos filtros de estado y tipo que la
//      ingesta), aplica el filtro de cobertura en código, y marca cada fila guardada que
//      aparece con `last_confirmed_at = startedAt`. Guarda cursor + conteo juntos.
//   3. Al cerrar la lista:
//        - PROTECCIÓN: si las claves vistas son < 80 % de las filas guardadas, ABORTA sin
//          borrar nada. Un feed incompleto (caída parcial, filtro roto, cambio de nombre
//          de un campo) no puede vaciar la tabla.
//        - Si pasa: borra lo NO confirmado cuyo `last_seen_at < startedAt`. La segunda
//          condición protege lo que el incremental metió o actualizó mientras la lista se
//          paginaba.
//
// Se ejecuta con los mismos gates que la sincronización (es ingesta: llama a Bridge).
import type { MlsFeedProvider } from "@/lib/mls/feed-port";
import { partitionByCoverage } from "@/lib/mls/coverage";

/** Fracción mínima de filas guardadas que la lista debe cubrir para permitir el borrado. */
export const RECONCILE_MIN_COVERAGE_RATIO = 0.8;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Toca reconciliar? Una vez por DÍA UTC: toca si la última reconciliación terminada es
 * de un día UTC anterior (o no hay ninguna).
 *
 * Antes era "20 h desde la anterior", y eso desfasaba el calendario: una corrida manual a
 * las 21:15 UTC dejó sin reconciliar toda la ventana de la mañana siguiente (08:07–10:52
 * UTC, apenas 11–14 h después) y la siguiente quedó a ~35 h (2026-10-11). Con el día UTC,
 * una corrida manual a cualquier hora no impide la de la mañana siguiente, y la ventana
 * del cron (08–10 UTC) garantiza como mucho ~27 h entre dos reconciliaciones.
 */
export function reconcileDue(lastFinishedAtMs: number | null, nowMs: number): boolean {
  if (lastFinishedAtMs === null) return true;
  return Math.floor(lastFinishedAtMs / DAY_MS) < Math.floor(nowMs / DAY_MS);
}

/**
 * Una reconciliación a medias más vieja que esto se REEMPIEZA: el nextLink de Bridge
 * podría haber caducado, y una lista armada a lo largo de más de un día ya no es una foto
 * coherente del feed.
 */
export const RECONCILE_STALE_AFTER_MS = 20 * 60 * 60 * 1000;

/**
 * Diagnóstico de frescura (Opción B, 2026-10-11): conteos de cómo están las fichas
 * guardadas frente a BridgeModificationTimestamp. SOLO MIDE: no corrige ni descarga nada.
 * Ver la migración 20261011170000.
 */
export interface Freshness {
  missing: number;
  stale: number;
  recent: number;
  current: number;
  unknown: number;
}

export const EMPTY_FRESHNESS: Freshness = { missing: 0, stale: 0, recent: 0, current: 0, unknown: 0 };

/** Un cambio de Bridge más nuevo que esto aún lo puede tomar el sync de cada hora. */
export const FRESHNESS_RECENT_MS = 2 * 60 * 60 * 1000;

function addFreshness(a: Freshness, b: Freshness): Freshness {
  return {
    missing: a.missing + b.missing, stale: a.stale + b.stale, recent: a.recent + b.recent,
    current: a.current + b.current, unknown: a.unknown + b.unknown,
  };
}

export interface ReconcileState {
  dataset: string;
  /** Inicio de la reconciliación EN CURSO; null = ninguna en curso. */
  startedAt: string | null;
  /** nextLink de la lista; null con `startedAt` puesto = empezar por la primera página. */
  cursor: string | null;
  /** Claves en cobertura vistas hasta ahora en la reconciliación en curso. */
  keysSeen: number;
  /** Cuándo terminó (ok o abortada) la última reconciliación. */
  lastFinishedAt: string | null;
  /** Diagnóstico acumulado de la reconciliación en curso. null = no disponible. */
  freshness?: Freshness | null;
}

export type ReconcileOutcome = "not_due" | "partial" | "failed" | "aborted" | "ok";

export interface ReconcileFinish {
  status: "ok" | "aborted";
  deleted: number;
  keysSeen: number;
  stored: number;
  error: string | null;
  /** Diagnóstico de frescura de toda la lista; null = no disponible. */
  freshness?: Freshness | null;
}

export interface ReconcileStore {
  readReconcileState(dataset: string): Promise<ReconcileState | null>;
  /** Abre una reconciliación: `startedAt`, cursor null, conteo 0. */
  beginReconciliation(dataset: string, startedAt: string): Promise<void>;
  /** Marca `last_confirmed_at = at` en las filas guardadas con esas claves. */
  confirmListings(listingKeys: string[], at: string): Promise<number>;
  /** Cursor, conteo y diagnóstico en UNA escritura: si no se guarda uno, no se guarda el otro. */
  saveReconcileProgress(
    dataset: string, cursor: string | null, keysSeen: number, freshness?: Freshness | null,
  ): Promise<void>;
  /**
   * Diagnóstico de SOLO LECTURA: compara la fecha de Bridge de cada clave con la guardada.
   * Opcional: sin él (o si falla), la reconciliación sigue igual y el diagnóstico queda null.
   */
  compareFreshness?(
    records: Array<{ key: string; bridgeTs: string | null }>, recentAfter: string,
  ): Promise<Freshness>;
  /** Filas guardadas en mls_listings. */
  countListings(): Promise<number>;
  /** Borra lo no confirmado con `last_seen_at < startedAt`; devuelve cuántas filas. */
  sweepUnconfirmed(startedAt: string): Promise<number>;
  /** Cierra la reconciliación en curso y registra el resultado. */
  finishReconciliation(dataset: string, result: ReconcileFinish): Promise<void>;
  /** Registra una invocación que no cerró (partial / failed). Nunca lanza. */
  recordReconcileRun(dataset: string, status: "partial" | "failed", error: string | null): Promise<void>;
}

export interface ReconcileDeps {
  provider: MlsFeedProvider;
  store: ReconcileStore;
  now(): number;
  timeBudgetMs: number;
  maxPages: number;
  staleAfterMs?: number;
  minCoverageRatio?: number;
}

export interface ReconcileSummary {
  dataset: string;
  outcome: ReconcileOutcome;
  /** true si esta invocación abrió la reconciliación. */
  started: boolean;
  /** true si se descartó una reconciliación a medias por vieja. */
  restartedStale: boolean;
  pages: number;
  /** Claves recibidas en esta invocación, antes del filtro de cobertura. */
  keysReceived: number;
  /** Claves en cobertura acumuladas en toda la reconciliación. */
  keysSeen: number;
  /** Filas guardadas al cerrar (solo al cerrar). */
  stored: number | null;
  deleted: number;
  stoppedBy: "completed" | "time_budget" | "max_pages" | "error" | "not_due";
  error: string | null;
  /** Diagnóstico de frescura acumulado (toda la lista al cerrar); null = no disponible. */
  freshness: Freshness | null;
}

export async function runMlsReconciliation(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const {
    provider, store, now, timeBudgetMs, maxPages,
    staleAfterMs = RECONCILE_STALE_AFTER_MS,
    minCoverageRatio = RECONCILE_MIN_COVERAGE_RATIO,
  } = deps;
  const dataset = provider.dataset;
  const inicioMs = now();

  const resumen: ReconcileSummary = {
    dataset, outcome: "partial", started: false, restartedStale: false, pages: 0,
    keysReceived: 0, keysSeen: 0, stored: null, deleted: 0, stoppedBy: "completed", error: null,
    freshness: null,
  };

  const estado = await store.readReconcileState(dataset);
  let startedAt = estado?.startedAt ?? null;

  if (startedAt !== null && inicioMs - Date.parse(startedAt) > staleAfterMs) {
    // A medias y vieja: se reempieza desde cero en vez de continuar un nextLink caducado.
    startedAt = null;
    resumen.restartedStale = true;
  }

  if (startedAt === null) {
    const ultima = estado?.lastFinishedAt ? Date.parse(estado.lastFinishedAt) : null;
    if (!resumen.restartedStale && !reconcileDue(ultima, inicioMs)) {
      return { ...resumen, outcome: "not_due", stoppedBy: "not_due" };
    }
    startedAt = new Date(inicioMs).toISOString();
    await store.beginReconciliation(dataset, startedAt);
    resumen.started = true;
  }

  let cursor = resumen.started ? null : estado?.cursor ?? null;
  let keysSeen = resumen.started ? 0 : estado?.keysSeen ?? 0;
  // Diagnóstico: arranca en cero en una reconciliación nueva; si se continúa una, sigue el
  // acumulado guardado (o queda no disponible si ya se había perdido).
  let freshness: Freshness | null = !store.compareFreshness
    ? null
    : resumen.started ? { ...EMPTY_FRESHNESS } : estado?.freshness ?? null;
  const recentAfter = new Date(Date.parse(startedAt) - FRESHNESS_RECENT_MS).toISOString();
  let completa = false;

  try {
    for (;;) {
      if (now() - inicioMs >= timeBudgetMs) { resumen.stoppedBy = "time_budget"; break; }
      if (resumen.pages >= maxPages) { resumen.stoppedBy = "max_pages"; break; }

      const pagina = await provider.fetchDisplayableKeys(cursor);
      resumen.pages += 1;
      resumen.keysReceived += pagina.keys.length;

      // Mismo criterio de cobertura que la ingesta: una clave fuera de los tres condados
      // no confirma su fila, así que si estaba guardada, el barrido la saca.
      const { included } = partitionByCoverage(pagina.keys);
      const claves = included.map((k) => k.ListingKey);
      if (claves.length > 0) await store.confirmListings(claves, startedAt);
      keysSeen += claves.length;

      // Diagnóstico de frescura: nunca tumba la reconciliación. Si falla una vez, queda no
      // disponible para el resto de esta lista (un total parcial engañaría).
      if (freshness !== null && store.compareFreshness && included.length > 0) {
        try {
          const f = await store.compareFreshness(
            included.map((k) => ({
              key: k.ListingKey,
              bridgeTs: typeof k.BridgeModificationTimestamp === "string" ? k.BridgeModificationTimestamp : null,
            })),
            recentAfter,
          );
          freshness = addFreshness(freshness, f);
        } catch (e) {
          freshness = null;
          console.error(JSON.stringify({
            event: "mls_freshness_unavailable",
            message: e instanceof Error ? e.message : String(e),
          }));
        }
      }

      cursor = pagina.nextCursor;
      await store.saveReconcileProgress(dataset, cursor, keysSeen, freshness);
      if (cursor === null) { completa = true; break; }
    }
  } catch (e) {
    resumen.stoppedBy = "error";
    resumen.error = e instanceof Error ? e.message : String(e);
  }
  resumen.keysSeen = keysSeen;
  resumen.freshness = freshness;

  if (!completa) {
    resumen.outcome = resumen.stoppedBy === "error" ? "failed" : "partial";
    await store.recordReconcileRun(dataset, resumen.outcome as "partial" | "failed", resumen.error);
    return resumen;
  }

  resumen.stoppedBy = "completed";
  const stored = await store.countListings();
  resumen.stored = stored;

  if (keysSeen < stored * minCoverageRatio) {
    // NO se borra nada. Se cierra igualmente (para no reintentar en bucle dentro de la
    // misma ventana) y queda registrado; la siguiente toca mañana.
    const motivo =
      `protección ${Math.round(minCoverageRatio * 100)} %: la lista trajo ${keysSeen} claves ` +
      `frente a ${stored} filas guardadas — no se borra nada`;
    resumen.outcome = "aborted";
    resumen.error = motivo;
    await store.finishReconciliation(dataset, {
      status: "aborted", deleted: 0, keysSeen, stored, error: motivo, freshness,
    });
    return resumen;
  }

  resumen.deleted = await store.sweepUnconfirmed(startedAt);
  resumen.outcome = "ok";
  await store.finishReconciliation(dataset, {
    status: "ok", deleted: resumen.deleted, keysSeen, stored, error: null, freshness,
  });
  return resumen;
}

/** ¿El resultado merece atención de un operador? */
export function reconcileNeedsAttention(s: ReconcileSummary): { attention: boolean; reason?: string } {
  if (s.outcome === "aborted") return { attention: true, reason: s.error ?? "reconciliación abortada" };
  if (s.outcome === "failed") return { attention: true, reason: `reconciliación falló: ${s.error}` };
  if (s.outcome === "ok" && s.stored !== null && s.stored > 0 && s.deleted / s.stored > 0.1) {
    // Pasó la protección del 80 % pero borró más de un 10 %: posible, no normal.
    return { attention: true, reason: `borró ${s.deleted} de ${s.stored} filas (>10 %)` };
  }
  return { attention: false };
}

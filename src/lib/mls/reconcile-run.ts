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

/** Una reconciliación por día. Algo menos de 24 h para que el horario no derive. */
export const RECONCILE_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Una reconciliación a medias más vieja que esto se REEMPIEZA: el nextLink de Bridge
 * podría haber caducado, y una lista armada a lo largo de más de un día ya no es una foto
 * coherente del feed.
 */
export const RECONCILE_STALE_AFTER_MS = 20 * 60 * 60 * 1000;

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
}

export type ReconcileOutcome = "not_due" | "partial" | "failed" | "aborted" | "ok";

export interface ReconcileFinish {
  status: "ok" | "aborted";
  deleted: number;
  keysSeen: number;
  stored: number;
  error: string | null;
}

export interface ReconcileStore {
  readReconcileState(dataset: string): Promise<ReconcileState | null>;
  /** Abre una reconciliación: `startedAt`, cursor null, conteo 0. */
  beginReconciliation(dataset: string, startedAt: string): Promise<void>;
  /** Marca `last_confirmed_at = at` en las filas guardadas con esas claves. */
  confirmListings(listingKeys: string[], at: string): Promise<number>;
  /** Cursor y conteo en UNA escritura: si no se guarda uno, no se guarda el otro. */
  saveReconcileProgress(dataset: string, cursor: string | null, keysSeen: number): Promise<void>;
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
  minIntervalMs?: number;
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
}

export async function runMlsReconciliation(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const {
    provider, store, now, timeBudgetMs, maxPages,
    minIntervalMs = RECONCILE_MIN_INTERVAL_MS,
    staleAfterMs = RECONCILE_STALE_AFTER_MS,
    minCoverageRatio = RECONCILE_MIN_COVERAGE_RATIO,
  } = deps;
  const dataset = provider.dataset;
  const inicioMs = now();

  const resumen: ReconcileSummary = {
    dataset, outcome: "partial", started: false, restartedStale: false, pages: 0,
    keysReceived: 0, keysSeen: 0, stored: null, deleted: 0, stoppedBy: "completed", error: null,
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
    if (!resumen.restartedStale && ultima !== null && inicioMs - ultima < minIntervalMs) {
      return { ...resumen, outcome: "not_due", stoppedBy: "not_due" };
    }
    startedAt = new Date(inicioMs).toISOString();
    await store.beginReconciliation(dataset, startedAt);
    resumen.started = true;
  }

  let cursor = resumen.started ? null : estado?.cursor ?? null;
  let keysSeen = resumen.started ? 0 : estado?.keysSeen ?? 0;
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

      cursor = pagina.nextCursor;
      await store.saveReconcileProgress(dataset, cursor, keysSeen);
      if (cursor === null) { completa = true; break; }
    }
  } catch (e) {
    resumen.stoppedBy = "error";
    resumen.error = e instanceof Error ? e.message : String(e);
  }
  resumen.keysSeen = keysSeen;

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
      status: "aborted", deleted: 0, keysSeen, stored, error: motivo,
    });
    return resumen;
  }

  resumen.deleted = await store.sweepUnconfirmed(startedAt);
  resumen.outcome = "ok";
  await store.finishReconciliation(dataset, {
    status: "ok", deleted: resumen.deleted, keysSeen, stored, error: null,
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

// Número de MLS de un listing PROPIO (`properties.mls_number`).
//
// Lo anota la broker a mano después de dar de alta el listing en Matrix — Lixtara no
// publica en el MLS por API. Es la clave con la que /properties evita mostrar dos veces
// el mismo inmueble (fila propia + ficha del feed IDX).
//
// NO se deduce del feed: cruzar automáticamente contra `mls_listings` sería procesar
// contenido licenciado fuera de la exhibición (§ III.B.9, abierto para el abogado). Por
// eso este módulo solo valida lo que una persona teclea; no importa nada de lib/mls.
//
// PURO: sin I/O.

/**
 * Formatos que publican los MLS del feed de MIAMI (MIAMI + Beaches):
 *   A11234567   — MIAMI (letra + dígitos)
 *   F10123456   — Beaches / Broward
 *   RX-10123456 — Beaches / Palm Beach
 * Deliberadamente tolerante (1–2 letras, guion opcional, 6–10 dígitos): un número
 * legítimo rechazado es peor que uno raro aceptado, porque el cruce exige coincidencia
 * exacta con `ListingId` y un error de formato solo deja la ficha duplicada visible.
 * ⚠️ Contrastar contra los `listing_id` reales en la fase 1 del runbook y ajustar.
 */
export const MLS_NUMBER_PATTERN = /^[A-Z]{1,2}-?\d{6,10}$/;

/** Mayúsculas y sin espacios. Es la MISMA normalización que usa el cruce de /properties. */
export function normalizeMlsNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.replace(/\s+/g, "").toUpperCase();
  return limpio.length > 0 ? limpio : null;
}

export type MlsNumberCheck =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "invalid_format" };

/** Normaliza y valida lo que tecleó una persona. */
export function parseMlsNumber(raw: string | null | undefined): MlsNumberCheck {
  const n = normalizeMlsNumber(raw);
  if (n === null) return { ok: false, reason: "empty" };
  if (!MLS_NUMBER_PATTERN.test(n)) return { ok: false, reason: "invalid_format" };
  return { ok: true, value: n };
}

/** Tipo de tarea de broker que recuerda anotar el número tras aprobar. */
export const ENTER_MLS_NUMBER_TASK = "enter_mls_number";

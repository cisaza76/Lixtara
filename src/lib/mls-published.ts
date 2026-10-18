// Fecha de publicación en el MLS (`properties.mls_published_at`): la prueba de devengo de la
// tarifa fija. La fija la broker desde /admin/listings/[id]/review con "Mark as published on
// the MLS", después de dar de alta el listing en Matrix. La política de reembolso
// (legal-terms.ts#refundPolicy) devuelve el total si el vendedor cancela antes de la
// publicación: esta fecha es la que lo decide.
//
// Las reglas viven en la base (migraciones 20261018170000 y 20261018190000,
// guard_properties_mls_published_at): listing aprobado (`active`), número de MLS, acuerdo
// `completed`, pago del plan `succeeded`, nunca en el futuro y, una vez fijada, solo un admin
// la corrige con nota. Aquí está lo mismo para la interfaz y los mensajes; la base es la
// garantía.
//
// PURO: sin I/O.

/** Largo mínimo de la nota de una corrección (el mismo que exige la base). */
export const MIN_CORRECTION_NOTE = 10;

export type RefundOnCancel = "full" | "flat_fee_earned";

/**
 * Qué corresponde si el vendedor cancela: sin fecha de publicación, reembolso total de la
 * tarifa fija; con fecha, la tarifa ya se devengó (salvo cobro doble o error técnico, que se
 * revisan aparte).
 */
export function refundOnCancel(mlsPublishedAt: string | null | undefined): RefundOnCancel {
  return mlsPublishedAt ? "flat_fee_earned" : "full";
}

export type MarkPublishedBlocker =
  | "already_published"
  | "listing_not_active"
  | "mls_number_required"
  | "agreement_not_completed"
  | "payment_not_succeeded";

/** Lo que falta para poder marcar el listing como publicado, en el orden en que se resuelve. */
export function markPublishedBlockers(input: {
  publishedAt: string | null;
  mlsStatus: string | null;
  mlsNumber: string | null;
  agreementStatus: string | null;
  planPaymentSucceeded: boolean;
}): MarkPublishedBlocker[] {
  if (input.publishedAt) return ["already_published"];
  const out: MarkPublishedBlocker[] = [];
  // Aprobado por la broker (migración 20261018190000).
  if (input.mlsStatus !== "active") out.push("listing_not_active");
  if (!input.agreementStatus || input.agreementStatus !== "completed") out.push("agreement_not_completed");
  if (!input.planPaymentSucceeded) out.push("payment_not_succeeded");
  if (!input.mlsNumber) out.push("mls_number_required");
  return out;
}

/** ¿El pago del plan está cobrado? La fotografía también es flat_fee, pero sin tier. */
export function isPlanPaymentSucceeded(
  payments: Array<{ payment_type: string | null; tier: string | null; status: string | null }>,
): boolean {
  return payments.some((p) => p.payment_type === "flat_fee" && p.tier !== null && p.status === "succeeded");
}

export type MlsPublishedWriteError =
  | MarkPublishedBlocker
  | "future_date"
  | "admin_only"
  | "note_required"
  | "taken"
  | "failed";

/** Traduce el error de la base (mensajes del guard) a un código para la interfaz. */
export function mapMlsPublishedWriteError(
  err: { code?: string; message?: string } | null,
): MlsPublishedWriteError | null {
  if (!err) return null;
  const m = err.message ?? "";
  if (err.code === "23505") return "taken";
  if (m.includes("requires the listing to be approved")) return "listing_not_active";
  if (m.includes("requires the MLS number")) return "mls_number_required";
  if (m.includes("listing agreement to be completed")) return "agreement_not_completed";
  if (m.includes("plan payment to have succeeded")) return "payment_not_succeeded";
  if (m.includes("cannot be in the future")) return "future_date";
  if (m.includes("requires a note")) return "note_required";
  if (m.includes("Only an admin can correct")) return "admin_only";
  return "failed";
}

const MIAMI = "America/New_York";

/**
 * Diferencia en minutos entre la hora de Miami y UTC en ese instante (-240 o -300). Se mide
 * sobre el minuto entero: con los segundos, 14:37:45 daba -240.75 → -241 y el selector de la
 * corrección mostraba un minuto menos que la ficha.
 */
function miamiOffsetMinutes(instant: Date): number {
  const at = new Date(Math.floor(instant.getTime() / 60000) * 60000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MIAMI,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * "YYYY-MM-DDTHH:mm" de un <input type="datetime-local">, leído como hora de Miami, a ISO UTC.
 * null si no tiene ese formato.
 */
export function parseMiamiDateTime(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(naive)) return null;
  // Dos pasadas: el desfase depende del instante (horario de verano).
  let ts = naive - miamiOffsetMinutes(new Date(naive)) * 60000;
  ts = naive - miamiOffsetMinutes(new Date(ts)) * 60000;
  const check = new Date(ts);
  return Number.isNaN(check.getTime()) ? null : check.toISOString();
}

/**
 * Fecha que guarda la corrección. Si el admin no tocó el selector (trae el mismo minuto que se
 * precargó desde la fecha actual), se conserva la fecha actual exacta, segundos incluidos:
 * guardar sin tocarla no la mueve.
 */
export function correctedPublishedAt(input: string, current: string | null): string | null {
  if (current && input.trim() === toMiamiDateTimeInput(current)) return current;
  return parseMiamiDateTime(input);
}

/** ISO UTC → "YYYY-MM-DDTHH:mm" en hora de Miami, para precargar un datetime-local. */
export function toMiamiDateTimeInput(iso: string): string {
  const at = new Date(iso);
  const local = new Date(at.getTime() + miamiOffsetMinutes(at) * 60000);
  return local.toISOString().slice(0, 16);
}

/** Fecha y hora de Miami para mostrar en el admin ("Oct 18, 2026, 2:05 PM ET"). */
export function formatMiamiDateTime(iso: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: MIAMI, dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    ) + " ET"
  );
}

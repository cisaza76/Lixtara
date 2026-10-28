// Plazo de firma con dos vendedores (#220). Puro: lo usan el cron /api/agreement/deadlines, la
// actualización del acuerdo (agreement-refresh.ts) y el botón de reenviar del paso 7.
//
// Reglas (owner, 2026-10-21):
//   - 7 días desde que se crea el sobre (signing_deadline_at = creación + 7 días).
//   - Recordatorios de Lixtara al segundo firmante a los días 2 y 5 (DocuSign manda los suyos
//     con el mismo calendario: envelopeNotification en docusign.ts).
//   - Al vencer sin todas las firmas: el sobre se anula, el acuerdo queda "expired" y se avisa a
//     los dos. El listing sigue en borrador (todavía no pagó: no hay nada que reembolsar); el
//     paso 7 ofrece crear un sobre nuevo, con otro plazo de 7 días.

import { SIGNING_DEADLINE_DAYS, SIGNING_REMINDER_EVERY_DAYS, SIGNING_REMINDER_FIRST_DAY } from "@/lib/listing-ownership";

const DAY_MS = 86_400_000;

/** Días (desde el envío) de cada recordatorio de Lixtara: [2, 5]. */
export const LIXTARA_REMINDER_DAYS = [SIGNING_REMINDER_FIRST_DAY, SIGNING_REMINDER_FIRST_DAY + SIGNING_REMINDER_EVERY_DAYS] as const;

/** Lo que el plazo necesita del acuerdo. */
export interface DeadlineRow {
  sellers_required: number | null;
  additional_signer_signed_at: string | null;
  signing_deadline_at: string | null;
  reminders_sent?: number | null;
}

/** Estados en los que el sobre sigue esperando firmas de vendedores. */
export const AWAITING_SELLERS = ["pending", "sent", "delivered"] as const;

export function isAwaitingSellers(status: string): boolean {
  return (AWAITING_SELLERS as readonly string[]).includes(status);
}

/** ¿El acuerdo espera todavía al segundo firmante, con plazo? */
export function waitsForCosigner(row: DeadlineRow): boolean {
  return row.sellers_required === 2 && !row.additional_signer_signed_at && !!row.signing_deadline_at;
}

/** ¿Pasó el plazo sin la firma del segundo vendedor? */
export function isSigningExpired(row: DeadlineRow, now: Date): boolean {
  if (!waitsForCosigner(row)) return false;
  const deadline = Date.parse(row.signing_deadline_at!);
  return Number.isFinite(deadline) && now.getTime() >= deadline;
}

export type DeadlineAction = { kind: "expire" } | { kind: "remind"; reminder: 1 | 2 } | { kind: "none" };

/**
 * Qué toca hacer ahora con un acuerdo que espera firmas. Un recordatorio que no salió a tiempo
 * (el cron no corrió) no se manda dos veces: a partir del día 5 se manda solo el segundo.
 */
export function deadlineAction(row: DeadlineRow, now: Date): DeadlineAction {
  if (!waitsForCosigner(row)) return { kind: "none" };
  if (isSigningExpired(row, now)) return { kind: "expire" };
  const start = Date.parse(row.signing_deadline_at!) - SIGNING_DEADLINE_DAYS * DAY_MS;
  const elapsedDays = (now.getTime() - start) / DAY_MS;
  const sent = row.reminders_sent ?? 0;
  if (elapsedDays >= LIXTARA_REMINDER_DAYS[1] && sent < 2) return { kind: "remind", reminder: 2 };
  if (elapsedDays >= LIXTARA_REMINDER_DAYS[0] && sent < 1) return { kind: "remind", reminder: 1 };
  return { kind: "none" };
}

/**
 * ¿Puede el vendedor reenviar la invitación? Solo mientras el sobre espera al segundo firmante y
 * el plazo no venció (vencido, el paso 7 crea un sobre nuevo).
 */
export function canResendInvitation(status: string, row: DeadlineRow, now: Date): boolean {
  return isAwaitingSellers(status) && waitsForCosigner(row) && !isSigningExpired(row, now);
}

/**
 * Paso 7: el vendedor ya firmó y el sobre espera al segundo firmante. Solo se muestra "Esperando
 * la firma de {nombre}" con "Reenviar": sin el aviso E-SIGN, la casilla, "Volver a abrir
 * DocuSign" ni "Confirmando tu firma…". `ownSigned` viene de DocuSign al cargar (null = no se
 * pudo leer: se muestra todo, como antes).
 */
export function onlyWaitingForCosigner(
  agreement: (DeadlineRow & { status: string }) | null,
  hasCosigner: boolean,
  ownSigned: boolean | null,
): boolean {
  return (
    !!agreement &&
    (agreement.status === "sent" || agreement.status === "delivered") &&
    agreement.sellers_required === 2 &&
    !agreement.additional_signer_signed_at &&
    hasCosigner &&
    ownSigned === true
  );
}

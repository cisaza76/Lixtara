// Listing agreement sent with the legal description PENDING (not verified with the county, so
// the contract says "See Attachment" and the attachment asks the broker to provide it). The
// admin can't approve/publish that listing until a new agreement goes out with it verified.
// Source of truth: agreements.legal_description_status (migration 20261021120000), written by
// /api/agreement/create; activity_log keeps an audit entry (AGREEMENT_SENT_ACTION).

export const AGREEMENT_SENT_ACTION = "agreement_sent";

export type AgreementLegalStatus = "verified" | "pending";

export interface AgreementRow {
  property_id: string;
  legal_description_status: string | null;
  created_at: string;
}

/**
 * Properties whose LATEST agreement isn't "verified". An agreement from before the column
 * (null) counts as pending: it was never checked against the county.
 */
export function pendingLegalFrom(agreements: AgreementRow[]): Set<string> {
  const latest = new Map<string, AgreementRow>();
  for (const a of agreements) {
    const cur = latest.get(a.property_id);
    if (!cur || a.created_at > cur.created_at) latest.set(a.property_id, a);
  }
  const out = new Set<string>();
  for (const [propertyId, a] of latest) if (a.legal_description_status !== "verified") out.add(propertyId);
  return out;
}

/** Admin message when approval is blocked (owner's wording, 2026-10-21). */
export function legalPendingMessage(lang: string): string {
  return lang === "es" ? "Falta descripción legal verificada" : "Verified legal description missing";
}

export function legalPendingHint(lang: string): string {
  return lang === "es"
    ? "El acuerdo se envió sin la descripción legal del condado («See Attachment»). Para publicar, verifica la parcela (folio) y envía un acuerdo nuevo."
    : "The agreement went out without the county legal description (\"See Attachment\"). To publish, verify the parcel (folio) and send a new agreement.";
}

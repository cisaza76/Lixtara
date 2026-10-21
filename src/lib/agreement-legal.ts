// Listing agreement sent with the legal description PENDING (not verified with the county, so
// the contract says "See Attachment" and the attachment asks the broker to provide it). The
// admin can't approve/publish that listing until a new agreement goes out with it verified.
// Recorded in activity_log when the envelope is created (metadata, no migration); read here.

export const AGREEMENT_SENT_ACTION = "agreement_sent";

export type AgreementLegalStatus = "verified" | "pending";

export interface AgreementRow {
  property_id: string;
  envelope_id: string | null;
  created_at: string;
}

export interface AgreementSentLog {
  property_id: string | null;
  metadata: { envelope_id?: unknown; legal_description?: unknown } | null;
}

/**
 * Properties whose LATEST agreement went out with the legal description pending. Older
 * agreements, or one sent before this record existed, never block.
 */
export function pendingLegalFrom(agreements: AgreementRow[], logs: AgreementSentLog[]): Set<string> {
  const latest = new Map<string, AgreementRow>();
  for (const a of agreements) {
    const cur = latest.get(a.property_id);
    if (!cur || a.created_at > cur.created_at) latest.set(a.property_id, a);
  }
  const pendingEnvelopes = new Set(
    logs.filter((l) => l.metadata?.legal_description === "pending").map((l) => String(l.metadata?.envelope_id ?? "")),
  );
  const out = new Set<string>();
  for (const [propertyId, a] of latest) if (a.envelope_id && pendingEnvelopes.has(a.envelope_id)) out.add(propertyId);
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

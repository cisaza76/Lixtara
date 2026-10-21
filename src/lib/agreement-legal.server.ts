import { createService } from "@/lib/supabase/service";
import { AGREEMENT_SENT_ACTION, pendingLegalFrom, type AgreementLegalStatus, type AgreementRow, type AgreementSentLog } from "./agreement-legal";

/** Logs the envelope and whether its legal description was verified. Never throws. */
export async function recordAgreementSent(input: {
  propertyId: string;
  userId: string;
  envelopeId: string;
  legal: AgreementLegalStatus;
}): Promise<void> {
  try {
    const { error } = await createService().from("activity_log").insert({
      property_id: input.propertyId,
      user_id: input.userId,
      action_type: AGREEMENT_SENT_ACTION,
      description: `Listing agreement sent (legal description ${input.legal})`,
      metadata: { envelope_id: input.envelopeId, legal_description: input.legal },
    });
    if (error) console.error("agreement_sent log failed", error.message);
  } catch (e) {
    console.error("agreement_sent log failed", e instanceof Error ? e.message : e);
  }
}

/**
 * Listings among `propertyIds` whose latest agreement has the legal description pending.
 * Service key: call only after checking the admin/broker role. On a read error it returns
 * every id (fail closed: better a blocked approval than a contract without the legal description).
 */
export async function pendingLegalByProperty(propertyIds: string[]): Promise<Set<string>> {
  if (propertyIds.length === 0) return new Set();
  const db = createService();
  const [ag, logs] = await Promise.all([
    db.from("agreements").select("property_id,envelope_id,created_at").in("property_id", propertyIds),
    db.from("activity_log").select("property_id,metadata").eq("action_type", AGREEMENT_SENT_ACTION).in("property_id", propertyIds),
  ]);
  if (ag.error || logs.error) {
    console.error("legal-pending read failed", ag.error?.message ?? logs.error?.message);
    return new Set(propertyIds);
  }
  return pendingLegalFrom((ag.data ?? []) as AgreementRow[], (logs.data ?? []) as AgreementSentLog[]);
}

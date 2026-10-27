import { createService } from "@/lib/supabase/service";
import { AGREEMENT_SENT_ACTION, pendingLegalFrom, type AgreementLegalStatus, type AgreementRow } from "./agreement-legal";

/** Audit entry (activity_log) for the envelope and its legal status. Never throws. */
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
 * Listings among `propertyIds` whose latest agreement has the legal description pending
 * (agreements.legal_description_status). Service key: call only after checking the
 * admin/broker role. On a read error it returns every id (fail closed: better a blocked
 * approval than a contract without the legal description).
 */
export async function pendingLegalByProperty(propertyIds: string[]): Promise<Set<string>> {
  if (propertyIds.length === 0) return new Set();
  try {
    const { data, error } = await createService()
      .from("agreements")
      .select("property_id,legal_description_status,created_at")
      .in("property_id", propertyIds);
    if (error) throw new Error(error.message);
    // Without any agreement there's nothing to approve yet: the countersignature gate blocks it.
    return pendingLegalFrom((data ?? []) as AgreementRow[]);
  } catch (e) {
    console.error("legal-pending read failed", e instanceof Error ? e.message : e);
    return new Set(propertyIds);
  }
}

// One place that brings an `agreements` row up to date with DocuSign, used by
// the seller's step-7 poller (/api/agreement/sync), the DocuSign webhook and
// the admin listing review. Before, only the seller's open page or a Connect
// webhook moved the status, so the admin kept seeing "sent" after the seller
// had signed, and the "agreement signed" email depended on the webhook alone.
//
// Rules:
// - DocuSign is the source of truth (never the caller's payload).
// - The seller's own signature counts as "signed" even while the envelope
//   waits for a countersignature (sellerHasSigned).
// - The status update is conditioned on the status we read, so when two
//   refreshes race only one performs the transition, and only that one sends
//   the "agreement signed" email.
// - The seller pays as soon as THEY sign ("signed"); the listing is published
//   (mls_status → active) only once the broker countersigned ("completed" with
//   the broker's signature verified): checkBrokerCountersigned below.

import { createService } from "@/lib/supabase/service";
import { BROKER_SIGNER_EMAIL } from "@/config/brokerage";
import {
  brokerHasCountersigned,
  getEnvelopeSigners,
  getEnvelopeStatus,
  mapEnvelopeStatus,
  secondSellerHasSigned,
  sellerHasSigned,
  type AgreementStatus,
} from "@/lib/docusign";
import { sendAgreementSigned } from "@/lib/email";
import { lookupRecipientLang } from "@/lib/email-recipient-lang";
import { SITE_URL } from "@/lib/config";
import { recordFunnelEvent } from "@/lib/funnel-events.server";

// "signed" (seller done) is not final: it still moves to "completed" once the
// countersignature lands.
const FINAL: AgreementStatus[] = ["completed", "declined", "voided", "expired"];

export interface AgreementRef {
  id: string;
  envelope_id: string | null;
  property_id: string;
  status: string;
}

export function isFinalAgreementStatus(status: string): boolean {
  return (FINAL as string[]).includes(status);
}

/** Pure: the status we should store, given DocuSign's envelope + signer info. */
export function resolveAgreementStatus(
  envelopeStatus: string,
  sellerSigned: boolean,
): AgreementStatus {
  const mapped = mapEnvelopeStatus(envelopeStatus);
  if ((mapped === "pending" || mapped === "sent" || mapped === "delivered") && sellerSigned) {
    return "signed";
  }
  return mapped;
}

/**
 * Refreshes one agreement from DocuSign. Returns the current status (the old
 * one when DocuSign can't be reached). Never throws.
 */
export async function refreshAgreement(a: AgreementRef): Promise<string> {
  return (await refreshAgreementResult(a)).status;
}

/**
 * refreshAgreement plus whether DocuSign could be read (`fetched`). The Connect
 * webhook answers 503 when it couldn't, so DocuSign retries the delivery.
 */
export async function refreshAgreementResult(
  a: AgreementRef,
): Promise<{ status: string; fetched: boolean }> {
  if (!a.envelope_id || isFinalAgreementStatus(a.status)) return { status: a.status, fetched: true };

  let next: AgreementStatus;
  let signedAt: string | null = null;
  let countersigned = false;
  try {
    const env = await getEnvelopeStatus(a.envelope_id);
    if (env.completedDateTime) signedAt = env.completedDateTime;
    const mapped = mapEnvelopeStatus(env.status);
    const needSigners = mapped === "pending" || mapped === "sent" || mapped === "delivered";
    const signers = needSigners ? await getEnvelopeSigners(a.envelope_id) : null;
    // Con dos vendedores (#220) cuenta solo cuando firmaron todos (sellerHasSigned).
    const signed = signers ? sellerHasSigned(signers, a.property_id) : false;
    if (signers && secondSellerHasSigned(signers)) await markSecondSellerSigned(a.id);
    next = resolveAgreementStatus(env.status, signed);
    if (next === "completed") {
      // Solo para el embudo: el estado pasa a "completed" aunque esta lectura falle.
      countersigned = await getEnvelopeSigners(a.envelope_id)
        .then((s) => brokerHasCountersigned(s, BROKER_SIGNER_EMAIL))
        .catch(() => false);
    }
  } catch (e) {
    console.error("agreement refresh: DocuSign fetch failed", e instanceof Error ? e.message : e);
    return { status: a.status, fetched: false };
  }
  if (next === a.status) return { status: a.status, fetched: true };

  const svc = createService();
  const update: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
  if (next === "signed" || next === "completed") {
    update.signed_at = signedAt ?? new Date().toISOString();
  }
  const { data: moved } = await svc
    .from("agreements")
    .update(update)
    .eq("id", a.id)
    .eq("status", a.status)
    .select("id");
  const won = Boolean(moved && moved.length > 0);

  // Email once, on the first transition into a signed state.
  const wasSigned = a.status === "signed" || a.status === "completed";
  if (won && !wasSigned && (next === "signed" || next === "completed")) {
    // Embudo: firmar ES terminar el paso 7. Una sola vez, la de la transición.
    await recordFunnelEvent({ event: "listing_step_complete", propertyId: a.property_id, step: 7 });
    await recordFunnelEvent({ event: "agreement_signed", propertyId: a.property_id, step: 7 });
    await notifySellerSigned(a.property_id).catch((e) =>
      console.error("agreement refresh: email failed", e instanceof Error ? e.message : e),
    );
  }
  // Contrafirma de la broker: una vez, en la transición a "completed" (a.status nunca es
  // final aquí). Evento de servidor; recordFunnelEvent decide is_test y nunca lanza.
  if (won && next === "completed" && countersigned) {
    await recordFunnelEvent({ event: "broker_countersigned", propertyId: a.property_id, step: 7 });
  }
  return { status: next, fetched: true };
}

export type PublishGate =
  | { ok: true }
  | { ok: false; reason: "not_countersigned" | "docusign_unavailable" };

/** Pure: may the listing go active, given the live agreement status and its signers? */
export function publishGateDecision(
  status: string | null,
  signers: Parameters<typeof brokerHasCountersigned>[0] | null,
  brokerEmail: string | null,
): PublishGate {
  if (status !== "completed") return { ok: false, reason: "not_countersigned" };
  if (signers === null) return { ok: false, reason: "docusign_unavailable" };
  return brokerHasCountersigned(signers, brokerEmail) ? { ok: true } : { ok: false, reason: "not_countersigned" };
}

/**
 * Publication gate (mls_status → active): the latest agreement must be completed in
 * DocuSign WITH the broker's countersignature. Asks DocuSign live; fails closed when it
 * can't be reached. Callers must already be staff.
 */
export async function checkBrokerCountersigned(propertyId: string): Promise<PublishGate> {
  const svc = createService();
  const { data } = await svc
    .from("agreements")
    .select("id,envelope_id,property_id,status")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const agreement = (data ?? null) as AgreementRef | null;
  if (!agreement?.envelope_id) return { ok: false, reason: "not_countersigned" };
  const status = await refreshAgreement(agreement);
  if (status !== "completed") return publishGateDecision(status, null, BROKER_SIGNER_EMAIL);
  const signers = await getEnvelopeSigners(agreement.envelope_id).catch((e) => {
    console.error("publish gate: DocuSign signers failed", e instanceof Error ? e.message : e);
    return null;
  });
  return publishGateDecision(status, signers, BROKER_SIGNER_EMAIL);
}

async function notifySellerSigned(propertyId: string) {
  const svc = createService();
  const { data: prop } = await svc
    .from("properties")
    .select("address_street,address_city,address_state,address_zip,owner_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) return;
  const { data: sellerAuth } = await svc.auth.admin.getUserById(prop.owner_id);
  const to = sellerAuth.user?.email;
  if (!to) return;
  const lang = (await lookupRecipientLang(prop.owner_id)) ?? "en";
  await sendAgreementSigned({
    to,
    lang,
    propertyAddress: `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`,
    paymentUrl: `${SITE_URL}/${lang}/listing/new?id=${propertyId}&step=8`,
  });
}

/** agreements.additional_signer_signed_at, una vez (#220). Best-effort: nunca lanza. */
async function markSecondSellerSigned(agreementId: string): Promise<void> {
  const { error } = await createService()
    .from("agreements")
    .update({ additional_signer_signed_at: new Date().toISOString() })
    .eq("id", agreementId)
    .eq("sellers_required", 2)
    .is("additional_signer_signed_at", null);
  if (error) console.error("agreement refresh: second seller mark failed", error.code);
}

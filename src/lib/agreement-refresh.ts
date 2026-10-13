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

import { createService } from "@/lib/supabase/service";
import {
  getEnvelopeSigners,
  getEnvelopeStatus,
  mapEnvelopeStatus,
  sellerHasSigned,
  type AgreementStatus,
} from "@/lib/docusign";
import { sendAgreementSigned } from "@/lib/email";
import { lookupRecipientLang } from "@/lib/email-recipient-lang";
import { SITE_URL } from "@/lib/config";

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
  if (!a.envelope_id || isFinalAgreementStatus(a.status)) return a.status;

  let next: AgreementStatus;
  let signedAt: string | null = null;
  try {
    const env = await getEnvelopeStatus(a.envelope_id);
    if (env.completedDateTime) signedAt = env.completedDateTime;
    const mapped = mapEnvelopeStatus(env.status);
    const needSigners = mapped === "pending" || mapped === "sent" || mapped === "delivered";
    const signed = needSigners
      ? sellerHasSigned(await getEnvelopeSigners(a.envelope_id), a.property_id)
      : false;
    next = resolveAgreementStatus(env.status, signed);
  } catch (e) {
    console.error("agreement refresh: DocuSign fetch failed", e instanceof Error ? e.message : e);
    return a.status;
  }
  if (next === a.status) return a.status;

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
    await notifySellerSigned(a.property_id).catch((e) =>
      console.error("agreement refresh: email failed", e instanceof Error ? e.message : e),
    );
  }
  return next;
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

// CAN-SPAM guard for commercial email (funnel / abandonment / marketing).
//
// 15 U.S.C. §7704(a)(5): every commercial message must include a clear opt-out
// mechanism and the sender's valid physical postal address. This module builds
// that footer and REFUSES (returns ok:false) when any required piece is
// missing, so callers cannot send a non-compliant email by accident.
// Transactional emails (receipts, signed-agreement notices) don't go through
// here — they use the existing helpers in src/lib/email.ts.

import {
  BROKER_LICENSE,
  BROKERAGE_LEGAL_NAME,
  BROKERAGE_POSTAL_ADDRESS,
} from "@/lib/broker";

export interface CommercialSenderIdentity {
  legalName: string;
  postalAddress: string;
}

export const COMMERCIAL_SENDER: CommercialSenderIdentity = {
  legalName: BROKERAGE_LEGAL_NAME,
  postalAddress: BROKERAGE_POSTAL_ADDRESS,
};

export type CanSpamMissing = "legal_name" | "postal_address" | "unsubscribe_url";

export type CanSpamFooter =
  | { ok: true; html: string; text: string }
  | { ok: false; missing: CanSpamMissing[] };

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function canSpamFooter(
  unsubscribeUrl: string,
  lang: "en" | "es",
  identity: CommercialSenderIdentity = COMMERCIAL_SENDER,
): CanSpamFooter {
  const missing: CanSpamMissing[] = [];
  if (!identity.legalName.trim()) missing.push("legal_name");
  if (!identity.postalAddress.trim()) missing.push("postal_address");
  if (!isHttpsUrl(unsubscribeUrl)) missing.push("unsubscribe_url");
  if (missing.length > 0) return { ok: false, missing };

  const name = identity.legalName.trim();
  const address = identity.postalAddress.trim();
  const why =
    lang === "es"
      ? "Recibes este correo porque empezaste a publicar una propiedad en Lixtara."
      : "You're receiving this email because you started listing a property on Lixtara.";
  const unsub = lang === "es" ? "Darme de baja" : "Unsubscribe";
  const licensed =
    lang === "es" ? "Brokerage licenciada en Florida" : "Licensed Florida brokerage";

  const html = `<p style="font-size:11px;color:#8a8268;line-height:1.6;margin:24px 0 0;">${escapeHtml(why)}<br>
${escapeHtml(name)} · ${escapeHtml(address)}<br>
${escapeHtml(licensed)} · Lic #${escapeHtml(BROKER_LICENSE)}<br>
<a href="${escapeHtml(unsubscribeUrl)}" style="color:#a18943;">${unsub}</a></p>`;
  const text = `\n\n--\n${why}\n${name} · ${address}\n${licensed} · Lic #${BROKER_LICENSE}\n${unsub}: ${unsubscribeUrl}`;
  return { ok: true, html, text };
}

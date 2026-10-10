// Transactional email wrapper around Resend.
//
// Sender:
//   - from     = EMAIL_FROM (e.g. "Lixtara <hola@lixtara.com>", a sender on the
//                lixtara.com domain verified in Resend). Unset = Resend's test
//                sender onboarding@resend.dev, which only delivers to the Resend
//                account owner, so real customers get nothing.
//   - reply-to = EMAIL_REPLY_TO when set (a real inbox for replies).
//   - to       = EMAIL_DEV_OVERRIDE_TO when set (debugging), otherwise the real
//                recipient. Never set it in Production.
//
// All public helpers (sendPaymentReceipt, sendAgreementSigned, etc.) are
// fire-and-forget from the caller's perspective — they NEVER throw. The
// surrounding flow (Stripe webhook, DocuSign webhook, admin approve) must not
// fail just because the email send did. We log errors instead.

import { Resend } from "resend";
import { BROKERAGE, brokerageLicenseLine } from "@/config/brokerage";
import {
  COMMERCIAL_SENDER,
  canSpamFooter,
  type CanSpamMissing,
  type CommercialSenderIdentity,
} from "@/lib/email-compliance";
import { escapeHtml } from "@/lib/contact-form";

let _client: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

const TEST_FROM = "Lixtara <onboarding@resend.dev>";

/** Sender for every Lixtara email (see header). */
export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || TEST_FROM;
}

function emailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO?.trim() || undefined;
}

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional override of from address (e.g. for broker-only notifications). */
  from?: string;
  /** UX 5C — provider-side dedup: identical key ⇒ Resend sends at most once. */
  idempotencyKey?: string;
  /** Extra MIME headers (e.g. List-Unsubscribe for commercial email). */
  headers?: Record<string, string>;
  /** Overrides EMAIL_REPLY_TO (e.g. the visitor who wrote via /contact). */
  replyTo?: string;
}

async function send(input: SendInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const c = client();
  if (!c) {
    console.warn("email: RESEND_API_KEY not configured, skipping send");
    return { ok: false, error: "no_api_key" };
  }
  const override = process.env.EMAIL_DEV_OVERRIDE_TO;
  const to = override ?? input.to;
  try {
    const { data, error } = await c.emails.send(
      {
        from: input.from ?? emailFrom(),
        ...((input.replyTo ?? emailReplyTo()) ? { replyTo: input.replyTo ?? emailReplyTo() } : {}),
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.headers ? { headers: input.headers } : {}),
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
    if (error) {
      console.error("email send error", { to, subject: input.subject, error });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("email send threw", { to, subject: input.subject, msg });
    return { ok: false, error: msg };
  }
}

type Lang = "en" | "es";

// ─── Shared HTML wrapper ─────────────────────────────────────────────

function shell(opts: { preheader: string; body: string; lang?: Lang }): string {
  const lang = opts.lang ?? "en";
  const tagline = lang === "es" ? "Brokerage en Florida" : "Florida brokerage";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lixtara</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1c1c;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #d8d1c0;">
      <tr><td style="padding:28px 32px;border-bottom:1px solid #ece6d6;">
        <span style="font-family:Georgia,serif;font-style:italic;font-size:28px;color:#1c1c1c;letter-spacing:-0.02em;">Lixtara</span>
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:#8a8268;margin-left:14px;">${tagline}</span>
      </td></tr>
      <tr><td style="padding:32px;">${opts.body}</td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #ece6d6;font-size:11px;color:#8a8268;line-height:1.6;">
        ${brokerageLicenseLine(lang)}<br>
        ${BROKERAGE.address}<br>
        <a href="https://lixtara.com" style="color:#a18943;text-decoration:none;">lixtara.com</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#1c1c1c;">
    <a href="${href}" style="display:inline-block;padding:14px 28px;color:#f4f1ec;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;text-decoration:none;font-weight:500;">${label}</a>
  </td></tr></table>`;
}

// ─── Public helpers ──────────────────────────────────────────────────

export interface PaymentReceiptInput {
  to: string;
  lang?: Lang;
  amount: number;
  tier: string;
  propertyAddress: string;
  receiptUrl?: string;
  dashboardUrl: string;
}

export async function sendPaymentReceipt(input: PaymentReceiptInput) {
  const lang = input.lang ?? "en";
  const isEs = lang === "es";
  const tierName = input.tier.charAt(0).toUpperCase() + input.tier.slice(1);
  const subject = isEs
    ? `Pago recibido por tu listing ${tierName} de Lixtara`
    : `Payment received for your ${tierName} Lixtara listing`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Tu pago llegó. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Gracias. Acabamos de procesar tu tarifa de listing <strong>${tierName}</strong> ($${input.amount.toLocaleString()}). Tu propiedad en <strong>${input.propertyAddress}</strong> está ahora en la cola de revisión del broker.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Nuestro broker la revisa típicamente dentro de un día hábil. Te avisamos por email apenas esté live en MLS.</p>
    ${button(input.dashboardUrl, "Ver mi dashboard")}
    <p style="font-size:12px;line-height:1.6;color:#666;">Recibo de pago${input.receiptUrl ? `: <a href="${input.receiptUrl}" style="color:#a18943;">ver en Stripe</a>` : " disponible en tu dashboard"}.</p>
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Payment confirmed. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Thank you. We've processed your <strong>${tierName}</strong> listing fee of $${input.amount.toLocaleString()}. Your property at <strong>${input.propertyAddress}</strong> is now in our broker review queue.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Our broker typically reviews within one business day. We'll email you the moment it goes live on MLS.</p>
    ${button(input.dashboardUrl, "View my dashboard")}
    <p style="font-size:12px;line-height:1.6;color:#666;">Payment receipt${input.receiptUrl ? `: <a href="${input.receiptUrl}" style="color:#a18943;">view on Stripe</a>` : " available in your dashboard"}.</p>
  `;

  const text = isEs
    ? `Pago recibido por $${input.amount.toLocaleString()} (${tierName}). Tu listing en ${input.propertyAddress} está en revisión del broker. Ver dashboard: ${input.dashboardUrl}`
    : `Payment received: $${input.amount.toLocaleString()} (${tierName}). Your listing at ${input.propertyAddress} is in broker review. Dashboard: ${input.dashboardUrl}`;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: isEs ? "Tu pago llegó" : "Payment confirmed", body, lang }),
    text,
  });
}

export interface AgreementSignedInput {
  to: string;
  lang?: Lang;
  propertyAddress: string;
  paymentUrl: string;
}

export async function sendAgreementSigned(input: AgreementSignedInput) {
  const lang = input.lang ?? "en";
  const isEs = lang === "es";
  const subject = isEs
    ? `Tu acuerdo de listing con Lixtara está firmado`
    : `Your Lixtara listing agreement is signed`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Tu acuerdo está firmado. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Recibimos tu firma del listing agreement para <strong>${input.propertyAddress}</strong>. El siguiente paso es el pago de tu tarifa fija para activar el listing.</p>
    ${button(input.paymentUrl, "Continuar al pago")}
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Your agreement is signed. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">We received your signature on the listing agreement for <strong>${input.propertyAddress}</strong>. Next step is your flat-fee payment to activate the listing.</p>
    ${button(input.paymentUrl, "Continue to payment")}
  `;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: isEs ? "Acuerdo firmado" : "Agreement signed", body, lang }),
    text: isEs
      ? `Tu acuerdo de listing está firmado. Continúa al pago: ${input.paymentUrl}`
      : `Your listing agreement is signed. Continue to payment: ${input.paymentUrl}`,
  });
}

export interface ListingApprovedInput {
  to: string;
  lang?: Lang;
  propertyAddress: string;
  listingUrl: string;
}

export async function sendListingApproved(input: ListingApprovedInput) {
  const lang = input.lang ?? "en";
  const isEs = lang === "es";
  const subject = isEs
    ? `🎉 Tu listing de Lixtara está en vivo en MLS`
    : `🎉 Your Lixtara listing is live on MLS`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">¡Tu listing está activo! 🎉</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Nuestro broker aprobó tu listing de <strong>${input.propertyAddress}</strong>. Acaba de sincronizarse con MLS y debería aparecer en Zillow, Realtor.com, Redfin y Trulia en las próximas horas.</p>
    ${button(input.listingUrl, "Ver mi listing")}
    <p style="font-size:13px;line-height:1.7;color:#1c1c1c;">Próximos pasos: las solicitudes de visita y las ofertas de los compradores van a aparecer en tu dashboard. Te avisamos por email de cada una.</p>
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Your listing is live! 🎉</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Our broker approved your listing for <strong>${input.propertyAddress}</strong>. It just synced to MLS and should appear on Zillow, Realtor.com, Redfin and Trulia within the next few hours.</p>
    ${button(input.listingUrl, "View my listing")}
    <p style="font-size:13px;line-height:1.7;color:#1c1c1c;">Next: showing requests and offers from buyers will appear in your dashboard. We'll email you each one.</p>
  `;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: isEs ? "Tu listing está en vivo" : "Your listing is live", body, lang }),
    text: isEs
      ? `Tu listing en ${input.propertyAddress} está activo en MLS. ${input.listingUrl}`
      : `Your listing at ${input.propertyAddress} is live on MLS. ${input.listingUrl}`,
  });
}

export interface BrokerNewPendingInput {
  /** Broker's email — distinct list from seller events. */
  to: string;
  sellerName: string;
  propertyAddress: string;
  tier: string;
  listPrice: number;
  adminUrl: string;
}

export async function sendBrokerNewPending(input: BrokerNewPendingInput) {
  const tierName = input.tier.charAt(0).toUpperCase() + input.tier.slice(1);
  const subject = `New listing pending review: ${input.propertyAddress}`;

  const body = `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">New listing for broker review</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">A seller paid + signed and is awaiting approval to go live on MLS.</p>
    <table cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:13px;color:#1c1c1c;">
      <tr><td style="padding:4px 16px 4px 0;color:#8a8268;text-transform:uppercase;font-size:10px;letter-spacing:0.18em;">Address</td><td style="padding:4px 0;">${input.propertyAddress}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#8a8268;text-transform:uppercase;font-size:10px;letter-spacing:0.18em;">Seller</td><td style="padding:4px 0;">${input.sellerName}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#8a8268;text-transform:uppercase;font-size:10px;letter-spacing:0.18em;">Tier</td><td style="padding:4px 0;">${tierName}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#8a8268;text-transform:uppercase;font-size:10px;letter-spacing:0.18em;">List price</td><td style="padding:4px 0;">$${input.listPrice.toLocaleString()}</td></tr>
    </table>
    ${button(input.adminUrl, "Open broker queue →")}
  `;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: `New listing pending review: ${input.propertyAddress}`, body }),
    text: `New listing pending review.\nAddress: ${input.propertyAddress}\nSeller: ${input.sellerName}\nTier: ${tierName}\nList price: $${input.listPrice.toLocaleString()}\n\n${input.adminUrl}`,
  });
}


// ---- UX 5C — listing-video terminal notification ------------------------------------
// Fire-and-forget like every sender here (NEVER throws). `idempotencyKey` makes the
// send at-most-once per (job, outcome) at the PROVIDER — retries/reconciliation of the
// same terminal transition cannot double-send (approved dedup basis: no migrations).
export async function sendListingVideoTerminal(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  return send(input);
}

// ─── Listing email gate (step 1) ─────────────────────────────────────
// Transactional: the seller asked for both (they typed their email to start a
// listing, or asked for a link to continue it), so no CAN-SPAM footer.

export async function sendListingEmailCode(input: {
  to: string;
  lang: Lang;
  code: string;
  minutes: number;
}) {
  const isEs = input.lang === "es";
  const subject = isEs
    ? `Tu código de Lixtara: ${input.code}`
    : `Your Lixtara code: ${input.code}`;
  const intro = isEs
    ? "Usa este código para confirmar tu email y seguir con tu listing."
    : "Use this code to confirm your email and keep going with your listing.";
  const expiry = isEs
    ? `Vence en ${input.minutes} minutos. Si no fuiste tú, ignora este correo.`
    : `It expires in ${input.minutes} minutes. If this wasn't you, you can ignore this email.`;
  const body = `
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;margin:0 0 16px;">${intro}</p>
    <p style="font-family:Georgia,serif;font-size:34px;letter-spacing:0.3em;color:#1c1c1c;margin:0 0 16px;">${input.code}</p>
    <p style="font-size:13px;line-height:1.7;color:#8a8268;">${expiry}</p>
  `;
  return send({
    to: input.to,
    subject,
    html: shell({ preheader: intro, body, lang: input.lang }),
    text: `${intro}\n\n${input.code}\n\n${expiry}`,
  });
}

export async function sendListingResumeLink(input: { to: string; lang: Lang; url: string }) {
  const isEs = input.lang === "es";
  const subject = isEs ? "Continúa tu listing en Lixtara" : "Continue your Lixtara listing";
  const intro = isEs
    ? "Tu listing te está esperando. Este link inicia tu sesión y te lleva al paso donde quedaste."
    : "Your listing is waiting for you. This link signs you in and takes you to the step where you left off.";
  const note = isEs
    ? "El link funciona una sola vez. Si no lo pediste, ignora este correo."
    : "The link works only once. If you didn't ask for it, you can ignore this email.";
  const body = `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">${subject}</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${intro}</p>
    ${button(input.url, isEs ? "Continuar mi listing" : "Continue my listing")}
    <p style="font-size:13px;line-height:1.7;color:#8a8268;">${note}</p>
  `;
  return send({
    to: input.to,
    subject,
    html: shell({ preheader: intro, body, lang: input.lang }),
    text: `${intro}\n\n${input.url}\n\n${note}`,
  });
}

// ─── Commercial email (CAN-SPAM) ─────────────────────────────────────

export interface CommercialEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  lang: Lang;
  /** https URL that opts this recipient out in one step (no login). */
  unsubscribeUrl: string;
  idempotencyKey?: string;
}

/**
 * The ONLY way to send funnel / abandonment / marketing email. Appends the
 * CAN-SPAM footer (legal name, physical postal address, unsubscribe link) and
 * List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058 one-click — the
 * unsubscribe URL must therefore also accept a POST). If the sender identity in src/lib/broker.ts is
 * incomplete or the unsubscribe URL is invalid, it does NOT send: it logs and
 * returns { ok: false, error: "can_spam_incomplete" }. Never throws.
 */
export async function sendCommercialEmail(
  input: CommercialEmailInput,
  identity: CommercialSenderIdentity = COMMERCIAL_SENDER,
): Promise<{ ok: boolean; id?: string; error?: string; missing?: CanSpamMissing[] }> {
  const footer = canSpamFooter(input.unsubscribeUrl, input.lang, identity);
  if (!footer.ok) {
    console.error("email: commercial send blocked — CAN-SPAM footer incomplete", {
      missing: footer.missing,
      subject: input.subject,
    });
    return { ok: false, error: "can_spam_incomplete", missing: footer.missing };
  }
  return send({
    to: input.to,
    subject: input.subject,
    html: input.html + footer.html,
    text: input.text + footer.text,
    idempotencyKey: input.idempotencyKey,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

// ─── Contact form (/contact) ─────────────────────────────────────────
// Internal notification to the brokerage inbox; reply-to is the visitor so
// answering the email answers them. All visitor input is HTML-escaped.

export async function sendContactMessage(input: {
  to: string;
  lang: Lang;
  name: string;
  email: string;
  phone: string;
  topic: string;
  message: string;
  pageUrl: string;
}) {
  const e = escapeHtml;
  const subject = `Contact form: ${input.name} (${input.topic})`;
  const rows: [string, string][] = [
    ["Name", input.name],
    ["Email", input.email],
    ["Phone", input.phone || "—"],
    ["Topic", input.topic],
    ["Language", input.lang],
  ];
  const body = `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">New message from lixtara.com</p>
    <table cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:13px;color:#1c1c1c;">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#8a8268;text-transform:uppercase;font-size:10px;letter-spacing:0.18em;">${k}</td><td style="padding:4px 0;">${e(v)}</td></tr>`,
        )
        .join("")}
    </table>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;white-space:pre-wrap;">${e(input.message)}</p>
    <p style="font-size:12px;color:#8a8268;">Reply to this email to answer ${e(input.name)} directly.</p>
  `;
  return send({
    to: input.to,
    replyTo: input.email,
    subject,
    html: shell({ preheader: subject, body }),
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${input.message}\n\n${input.pageUrl}`,
  });
}

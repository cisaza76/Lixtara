// Transactional email wrapper around Resend.
//
// Test mode posture (until lixtara.com is verified in Resend):
//   - from = onboarding@resend.dev (Resend's no-DNS sender)
//   - to   = EMAIL_DEV_OVERRIDE_TO when set, otherwise the real recipient
// Set EMAIL_DEV_OVERRIDE_TO to your own email to receive everything for
// debugging. Remove the env var once you're on a verified domain.
//
// All public helpers (sendPaymentReceipt, sendAgreementSigned, etc.) are
// fire-and-forget from the caller's perspective — they NEVER throw. The
// surrounding flow (Stripe webhook, KIRI webhook, admin approve) must not
// fail just because the email send did. We log errors instead.

import { Resend } from "resend";

let _client: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

const DEFAULT_FROM = "Lixtara <onboarding@resend.dev>";

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional override of from address (e.g. for broker-only notifications). */
  from?: string;
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
    const { data, error } = await c.emails.send({
      from: input.from ?? DEFAULT_FROM,
      to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
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

// ─── Shared HTML wrapper ─────────────────────────────────────────────

function shell(opts: { preheader: string; body: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lixtara</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1c1c;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #d8d1c0;">
      <tr><td style="padding:28px 32px;border-bottom:1px solid #ece6d6;">
        <span style="font-family:Georgia,serif;font-style:italic;font-size:28px;color:#1c1c1c;letter-spacing:-0.02em;">Lixtara</span>
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:#8a8268;margin-left:14px;">Florida brokerage</span>
      </td></tr>
      <tr><td style="padding:32px;">${opts.body}</td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #ece6d6;font-size:11px;color:#8a8268;line-height:1.6;">
        Lixtara · Powered by Nexxos Realty · License #BK3166173<br>
        <a href="https://lixtara.vercel.app" style="color:#a18943;text-decoration:none;">lixtara.com</a>
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

type Lang = "en" | "es";

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
    ? `Pago recibido — listing ${tierName} de Lixtara`
    : `Payment received — your ${tierName} Lixtara listing`;

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
    html: shell({ preheader: isEs ? "Tu pago llegó" : "Payment confirmed", body }),
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
    ? `Acuerdo de listing firmado — Lixtara`
    : `Listing agreement signed — Lixtara`;

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
    html: shell({ preheader: isEs ? "Acuerdo firmado" : "Agreement signed", body }),
    text: isEs
      ? `Tu acuerdo de listing está firmado. Continúa al pago: ${input.paymentUrl}`
      : `Your listing agreement is signed. Continue to payment: ${input.paymentUrl}`,
  });
}

export interface TourReadyInput {
  to: string;
  lang?: Lang;
  propertyAddress: string;
  listingUrl: string;
}

export async function sendTourReady(input: TourReadyInput) {
  const lang = input.lang ?? "en";
  const isEs = lang === "es";
  const subject = isEs
    ? `Tu tour 3D está listo — Lixtara`
    : `Your 3D walkthrough tour is live — Lixtara`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Tu tour 3D está listo. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Procesamos el video que subiste de <strong>${input.propertyAddress}</strong> y la escena 3D Gaussian Splatting está ahora embebida en tu página de listing. Los compradores pueden recorrerla en cualquier navegador.</p>
    ${button(input.listingUrl, "Ver mi listing")}
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Your 3D tour is live. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">We processed the walkthrough video you uploaded for <strong>${input.propertyAddress}</strong> and the 3D Gaussian Splatting scene is now embedded on your listing page. Buyers can navigate it from any browser.</p>
    ${button(input.listingUrl, "View my listing")}
  `;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: isEs ? "Tu tour 3D está listo" : "Your 3D tour is ready", body }),
    text: isEs
      ? `Tu tour 3D está listo para ${input.propertyAddress}. Verlo: ${input.listingUrl}`
      : `Your 3D tour is ready for ${input.propertyAddress}. View it: ${input.listingUrl}`,
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
    ? `🎉 Tu listing está en vivo en MLS — Lixtara`
    : `🎉 Your listing is live on MLS — Lixtara`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">¡Tu listing está activo! 🎉</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Nuestro broker aprobó tu listing de <strong>${input.propertyAddress}</strong>. Acaba de sincronizarse con MLS y debería aparecer en Zillow, Realtor.com, Redfin y Trulia en las próximas horas.</p>
    ${button(input.listingUrl, "Ver mi listing")}
    <p style="font-size:13px;line-height:1.7;color:#1c1c1c;">Próximos pasos: las solicitudes de visitas e ofertas que reciban los buyers van a aparecer en tu dashboard. Te notificamos por email cada una.</p>
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
    html: shell({ preheader: isEs ? "Tu listing está en vivo" : "Your listing is live", body }),
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
  const subject = `New listing pending review — ${input.propertyAddress}`;

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

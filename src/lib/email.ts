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

import { publicationTimeline, refundPolicy } from "@/config/legal-terms";
import { Resend } from "resend";
import { BROKERAGE, brokerageLicenseLine } from "@/config/brokerage";
import {
  COMMERCIAL_SENDER,
  canSpamFooter,
  type CanSpamMissing,
  type CommercialSenderIdentity,
} from "@/lib/email-compliance";
import { escapeHtml } from "@/lib/contact-form";
import { PRICING_TIERS, isPricingTierId } from "@/lib/pricing-tiers";

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
  /** Files attached to the email (e.g. the accepted NBR notice PDF). */
  attachments?: Array<{ filename: string; content: Buffer }>;
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
        ...(input.attachments ? { attachments: input.attachments } : {}),
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
  // The flat fee is not the whole price: the plan's % is due at closing, only if it sells.
  const commissionPct = isPricingTierId(input.tier) ? PRICING_TIERS[input.tier].commissionPct : null;
  const commissionLine = commissionPct === null
    ? ""
    : isEs
      ? `Además de esta tarifa fija, tu plan incluye una comisión de Lixtara del ${commissionPct}% del precio de venta, que se paga al cierre y solo si tu propiedad se vende.`
      : `In addition to this flat fee, your plan includes a ${commissionPct}% Lixtara commission on the sale price, paid at closing and only if your property sells.`;
  // Plazo y reembolso: los mismos textos que el paso 8, la FAQ y los Términos.
  const publication = publicationTimeline.text[lang].sentence;
  const refund = refundPolicy.text[lang];
  const commissionHtml = commissionLine
    ? `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${commissionLine}</p>`
    : "";
  const subject = isEs
    ? `Pago recibido por tu plan ${tierName} de Lixtara`
    : `Payment received for your ${tierName} Lixtara plan`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Tu pago llegó. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Gracias. Acabamos de procesar la tarifa fija de tu plan <strong>${tierName}</strong> ($${input.amount.toLocaleString()}). Tu propiedad en <strong>${input.propertyAddress}</strong> está ahora en la cola de revisión de la broker.</p>
    ${commissionHtml}
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${publication} Te avisamos por correo apenas esté publicada en el MLS.</p>
    ${button(input.dashboardUrl, "Ver mi panel")}
    <p style="font-size:12px;line-height:1.6;color:#666;">${refund}</p>
    <p style="font-size:12px;line-height:1.6;color:#666;">Recibo de pago${input.receiptUrl ? `: <a href="${input.receiptUrl}" style="color:#a18943;">ver en Stripe</a>` : " disponible en tu dashboard"}.</p>
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Payment confirmed. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Thank you. We've processed the flat fee for your <strong>${tierName}</strong> plan ($${input.amount.toLocaleString()}). Your property at <strong>${input.propertyAddress}</strong> is now in the broker's review queue.</p>
    ${commissionHtml}
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${publication} We'll email you as soon as it's published on the MLS.</p>
    ${button(input.dashboardUrl, "View my dashboard")}
    <p style="font-size:12px;line-height:1.6;color:#666;">${refund}</p>
    <p style="font-size:12px;line-height:1.6;color:#666;">Payment receipt${input.receiptUrl ? `: <a href="${input.receiptUrl}" style="color:#a18943;">view on Stripe</a>` : " available in your dashboard"}.</p>
  `;

  const text = isEs
    ? `Pago recibido por $${input.amount.toLocaleString()} (${tierName}). Tu listado en ${input.propertyAddress} está en revisión de la broker. ${commissionLine} ${publication} ${refund} Ver panel: ${input.dashboardUrl}`
    : `Payment received: $${input.amount.toLocaleString()} (${tierName}). Your listing at ${input.propertyAddress} is in broker review. ${commissionLine} ${publication} ${refund} Dashboard: ${input.dashboardUrl}`;

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
    ? `Tu acuerdo de listado con Lixtara está firmado`
    : `Your Lixtara listing agreement is signed`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Tu acuerdo está firmado. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Recibimos tu firma del acuerdo de listado para <strong>${input.propertyAddress}</strong>. El siguiente paso es el pago de tu tarifa fija.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${publicationTimeline.text.es.sentence}</p>
    ${button(input.paymentUrl, "Continuar al pago")}
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Your agreement is signed. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">We received your signature on the listing agreement for <strong>${input.propertyAddress}</strong>. The next step is paying your flat fee.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${publicationTimeline.text.en.sentence}</p>
    ${button(input.paymentUrl, "Continue to payment")}
  `;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: isEs ? "Acuerdo firmado" : "Agreement signed", body, lang }),
    text: isEs
      ? `Tu acuerdo de listado está firmado. Continúa al pago: ${input.paymentUrl}`
      : `Your listing agreement is signed. Continue to payment: ${input.paymentUrl}`,
  });
}

/**
 * Dos vendedores (#220): al vendedor, cuando firmó el último de los dos (él o el otro). Reemplaza
 * a sendAgreementSigned en ese caso: una sola vez por acuerdo (idempotencyKey).
 */
export async function sendAllSellersSigned(input: AgreementSignedInput & { idempotencyKey: string }) {
  const isEs = (input.lang ?? "en") === "es";
  const address = escapeHtml(input.propertyAddress);
  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Ya firmaron todos. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Los dos vendedores firmaron el acuerdo de listado de <strong>${address}</strong>. Completa el pago de tu tarifa fija para continuar.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${publicationTimeline.text.es.sentence}</p>
    ${button(input.paymentUrl, "Continuar al pago")}
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Everyone has signed. ✓</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Both sellers signed the listing agreement for <strong>${address}</strong>. Complete the payment of your flat fee to continue.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${publicationTimeline.text.en.sentence}</p>
    ${button(input.paymentUrl, "Continue to payment")}
  `;
  return send({
    to: input.to,
    subject: isEs ? "Ya firmaron todos: completa el pago para continuar" : "Everyone has signed: complete the payment to continue",
    html: shell({ preheader: isEs ? "Ya firmaron todos" : "Everyone has signed", body, lang: isEs ? "es" : "en" }),
    text: isEs
      ? `Ya firmaron todos el acuerdo de listado de ${input.propertyAddress}. Completa el pago para continuar: ${input.paymentUrl}`
      : `Everyone has signed the listing agreement for ${input.propertyAddress}. Complete the payment to continue: ${input.paymentUrl}`,
    idempotencyKey: input.idempotencyKey,
  });
}

// ─── Segundo vendedor (#220) ─────────────────────────────────────────
//
// El segundo firmante no tiene cuenta: firma por el correo de DocuSign. Lixtara le escribe aparte
// para explicarle qué firma y por qué (y los recordatorios de los días 2 y 5). Como no sabemos su
// idioma, sus correos van en los dos, primero el del vendedor. Todo lo que escribió el vendedor
// (nombres, dirección) va escapado.

export type CosignerRelationship = "title_holder" | "homestead_spouse";
export type CosignerEmailKind = "invite" | "reminder" | "resend";

/** "November 4, 2026" / "4 de noviembre de 2026", en hora de Miami. */
export function signingDeadlineLabel(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export interface CosignerInvitationInput {
  to: string;
  /** Idioma del vendedor: el asunto y el primer bloque. */
  lang?: Lang;
  kind: CosignerEmailKind;
  sellerName: string;
  signerName: string;
  relationship: CosignerRelationship;
  propertyAddress: string;
  deadlineIso: string;
  idempotencyKey: string;
}

function cosignerInvitationLines(input: CosignerInvitationInput, lang: Lang, html: boolean): string[] {
  const esc = html ? escapeHtml : (v: string) => v;
  const seller = esc(input.sellerName);
  const signer = esc(input.signerName);
  const strong = (v: string) => (html ? `<strong>${v}</strong>` : v);
  const address = strong(esc(input.propertyAddress));
  const date = strong(signingDeadlineLabel(input.deadlineIso, lang));
  if (lang === "es") {
    return [
      input.kind === "reminder"
        ? `Hola, ${signer}: te recordamos que el acuerdo de listado de ${address} espera tu firma.`
        : `Hola, ${signer}: ${seller} quiere poner a la venta ${address} con Lixtara y necesita tu firma en el acuerdo de listado.`,
      `El acuerdo autoriza a Lixtara, la brokerage con licencia en Florida, a publicar la propiedad a la venta. Ahí están la tarifa, la comisión y el plazo del listado.`,
      input.relationship === "title_holder"
        ? `Te pedimos firmar porque figuras en el título de la propiedad junto con ${seller}.`
        : `Te pedimos firmar porque la propiedad es la residencia principal (homestead) de un propietario casado: en ese caso, el cónyuge también firma el acuerdo.`,
      `DocuSign te mandó un correo aparte con el enlace para leerlo y firmarlo. Búscalo en tu bandeja de entrada o en la carpeta de spam. El plazo para firmar vence el ${date}. Si no firmas para esa fecha, el acuerdo se anula y no se publica nada.`,
      `Si no esperabas este correo, respóndelo y te ayudamos.`,
    ];
  }
  return [
    input.kind === "reminder"
      ? `Hi ${signer}, this is a reminder that the listing agreement for ${address} is waiting for your signature.`
      : `Hi ${signer}, ${seller} wants to list ${address} for sale with Lixtara and needs your signature on the listing agreement.`,
    `The agreement authorizes Lixtara, a licensed Florida brokerage, to list the property for sale. It sets out the fee, the commission and the term of the listing.`,
    input.relationship === "title_holder"
      ? `We're asking you to sign because you're on the property's title together with ${seller}.`
      : `We're asking you to sign because the property is the primary residence (homestead) of a married owner: in that case, the spouse signs the agreement too.`,
    `DocuSign sent you a separate email with the link to read and sign it. Look for it in your inbox or your spam folder. The deadline to sign is ${date}. If it isn't signed by then, the agreement is voided and nothing is published.`,
    `If you weren't expecting this email, reply to it and we'll help.`,
  ];
}

function cosignerInvitationBlock(input: CosignerInvitationInput, lang: Lang): { html: string; text: string } {
  const p = (v: string) => `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${v}</p>`;
  return {
    html: cosignerInvitationLines(input, lang, true).map(p).join(""),
    text: cosignerInvitationLines(input, lang, false).join("\n\n"),
  };
}

export async function sendCosignerInvitation(input: CosignerInvitationInput) {
  const lang = input.lang ?? "en";
  const other: Lang = lang === "es" ? "en" : "es";
  const first = cosignerInvitationBlock(input, lang);
  const second = cosignerInvitationBlock(input, other);
  const address = input.propertyAddress;
  const subject =
    lang === "es"
      ? input.kind === "reminder"
        ? `Recordatorio: el acuerdo de listado de ${address} espera tu firma`
        : `${input.sellerName} te pidió firmar el acuerdo de listado de ${address}`
      : input.kind === "reminder"
        ? `Reminder: the listing agreement for ${address} is waiting for your signature`
        : `${input.sellerName} asked you to sign the listing agreement for ${address}`;
  const divider = `<hr style="border:none;border-top:1px solid #ece6d6;margin:28px 0;">`;
  return send({
    to: input.to,
    subject,
    html: shell({
      preheader: lang === "es" ? "Tu firma en el acuerdo de listado" : "Your signature on the listing agreement",
      body: first.html + divider + `<div lang="${other}">${second.html}</div>`,
      lang,
    }),
    text: `${first.text}\n\n---\n\n${second.text}`,
    idempotencyKey: input.idempotencyKey,
  });
}

export interface CosignerSignedInput {
  to: string;
  lang?: Lang;
  signerName: string;
  propertyAddress: string;
  stepUrl: string;
}

/** Al vendedor, cuando el segundo firmante firmó y falta su firma. */
export async function sendCosignerSigned(input: CosignerSignedInput) {
  const isEs = (input.lang ?? "en") === "es";
  const signer = escapeHtml(input.signerName);
  const address = escapeHtml(input.propertyAddress);
  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">${signer} firmó el acuerdo.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${signer} firmó el acuerdo de listado de <strong>${address}</strong>. Solo falta tu firma, en el paso 7. Después sigue el pago.</p>
    ${button(input.stepUrl, "Firmar el acuerdo")}
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">${signer} signed the agreement.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${signer} signed the listing agreement for <strong>${address}</strong>. Only your signature is missing, in step 7. Payment comes next.</p>
    ${button(input.stepUrl, "Sign the agreement")}
  `;
  return send({
    to: input.to,
    subject: isEs ? `${input.signerName} firmó el acuerdo de listado` : `${input.signerName} signed the listing agreement`,
    html: shell({ preheader: isEs ? "Falta tu firma" : "Your signature is next", body, lang: isEs ? "es" : "en" }),
    text: isEs
      ? `${input.signerName} firmó el acuerdo de listado de ${input.propertyAddress}. Solo falta tu firma: ${input.stepUrl}`
      : `${input.signerName} signed the listing agreement for ${input.propertyAddress}. Only your signature is missing: ${input.stepUrl}`,
  });
}

export interface SigningExpiredInput {
  to: string;
  lang?: Lang;
  /** Quién no firmó a tiempo (el segundo firmante). */
  signerName: string;
  propertyAddress: string;
  stepUrl: string;
  idempotencyKey: string;
}

/** Al vendedor, cuando el plazo de 7 días venció sin todas las firmas. */
export async function sendSigningExpired(input: SigningExpiredInput) {
  const isEs = (input.lang ?? "en") === "es";
  const signer = escapeHtml(input.signerName);
  const address = escapeHtml(input.propertyAddress);
  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">El plazo para firmar venció.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">El acuerdo de listado de <strong>${address}</strong> no tiene la firma de ${signer}, y pasaron los 7 días para firmarlo. Lo anulamos.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Tu listing sigue como borrador y no se te cobró nada. Cuando quieras, envía un acuerdo nuevo desde el paso 7: hay otros 7 días para firmarlo.</p>
    ${button(input.stepUrl, "Enviar un acuerdo nuevo")}
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">The signing deadline passed.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">The listing agreement for <strong>${address}</strong> doesn't have ${signer}'s signature, and the 7 days to sign it are over. We voided it.</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Your listing is still a draft and you haven't been charged. Whenever you're ready, send a new agreement from step 7: it comes with another 7 days to sign.</p>
    ${button(input.stepUrl, "Send a new agreement")}
  `;
  return send({
    to: input.to,
    subject: isEs ? `El acuerdo de listado de ${input.propertyAddress} venció sin todas las firmas` : `The listing agreement for ${input.propertyAddress} expired without every signature`,
    html: shell({ preheader: isEs ? "Plazo de firma vencido" : "Signing deadline passed", body, lang: isEs ? "es" : "en" }),
    text: isEs
      ? `El acuerdo de listado de ${input.propertyAddress} venció sin la firma de ${input.signerName}. Tu listing sigue como borrador y no se te cobró nada. Envía un acuerdo nuevo: ${input.stepUrl}`
      : `The listing agreement for ${input.propertyAddress} expired without ${input.signerName}'s signature. Your listing is still a draft and you haven't been charged. Send a new agreement: ${input.stepUrl}`,
    idempotencyKey: input.idempotencyKey,
  });
}

export interface CosignerExpiredInput {
  to: string;
  lang?: Lang;
  sellerName: string;
  propertyAddress: string;
  idempotencyKey: string;
}

/** Al segundo firmante, cuando el plazo venció (en los dos idiomas, como su invitación). */
export async function sendCosignerExpired(input: CosignerExpiredInput) {
  const lang = input.lang ?? "en";
  const seller = escapeHtml(input.sellerName);
  const address = escapeHtml(input.propertyAddress);
  const es = (s: string, a: string) =>
    `El acuerdo de listado de ${a} que te mandó ${s} venció sin tu firma y lo anulamos. No tienes que hacer nada. Si ${s} manda uno nuevo, DocuSign te va a escribir otra vez.`;
  const en = (s: string, a: string) =>
    `The listing agreement for ${a} that ${s} sent you expired without your signature, and we voided it. You don't need to do anything. If ${s} sends a new one, DocuSign will email you again.`;
  const [firstOf, secondOf] = lang === "es" ? [es, en] : [en, es];
  const first = firstOf(seller, `<strong>${address}</strong>`);
  const second = secondOf(seller, `<strong>${address}</strong>`);
  const plain = `${firstOf(input.sellerName, input.propertyAddress)}\n\n---\n\n${secondOf(input.sellerName, input.propertyAddress)}`;
  const p = (s: string) => `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${s}</p>`;
  return send({
    to: input.to,
    subject:
      lang === "es"
        ? `El acuerdo de listado de ${input.propertyAddress} venció`
        : `The listing agreement for ${input.propertyAddress} expired`,
    html: shell({
      preheader: lang === "es" ? "Acuerdo anulado" : "Agreement voided",
      body: p(first) + `<hr style="border:none;border-top:1px solid #ece6d6;margin:28px 0;">` + p(second),
      lang,
    }),
    text: plain,
    idempotencyKey: input.idempotencyKey,
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
    ? `🎉 Tu propiedad está publicada en el MLS`
    : `🎉 Your property is published on the MLS`;

  const body = isEs
    ? `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">¡Tu propiedad está publicada! 🎉</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">La broker aprobó tu listado de <strong>${input.propertyAddress}</strong> y ya está publicado en el MLS. Desde el MLS se distribuye a portales como Zillow, Realtor.com, Redfin y Trulia; cada portal decide cuándo y cómo lo muestra.</p>
    ${button(input.listingUrl, "Ver mi listado")}
    <p style="font-size:13px;line-height:1.7;color:#1c1c1c;">Próximos pasos: las solicitudes de visita y las ofertas de los compradores van a aparecer en tu panel. Te avisamos por correo de cada una.</p>
    <p style="font-size:12px;line-height:1.6;color:#666;">${refundPolicy.text.es}</p>
  `
    : `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">Your property is published! 🎉</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">The broker approved your listing for <strong>${input.propertyAddress}</strong>, and it's now published on the MLS. From the MLS it's syndicated to portals like Zillow, Realtor.com, Redfin and Trulia; each portal decides when and how it shows it.</p>
    ${button(input.listingUrl, "View my listing")}
    <p style="font-size:13px;line-height:1.7;color:#1c1c1c;">Next: showing requests and offers from buyers will appear in your dashboard. We'll email you each one.</p>
    <p style="font-size:12px;line-height:1.6;color:#666;">${refundPolicy.text.en}</p>
  `;

  return send({
    to: input.to,
    subject,
    html: shell({ preheader: isEs ? "Tu propiedad está publicada en el MLS" : "Your property is published on the MLS", body, lang }),
    text: isEs
      ? `Tu propiedad en ${input.propertyAddress} está publicada en el MLS. ${input.listingUrl} ${refundPolicy.text.es}`
      : `Your property at ${input.propertyAddress} is published on the MLS. ${input.listingUrl} ${refundPolicy.text.en}`,
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
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">A seller paid + signed and is awaiting approval to be published on the MLS.</p>
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


// ---- #134 / #136 — solicitud del vendedor sobre un listing ya enviado -----------------
export interface BrokerListingRequestInput {
  to: string;
  kind: "change" | "withdrawal";
  propertyAddress: string;
  /** Resumen "campo: antes → después" (cambio) o null (retiro). */
  summary: string | null;
  reason: string | null;
  reviewUrl: string;
  /** Una notificación por solicitud aunque el endpoint se reintente. */
  requestId: string;
}

export async function sendBrokerListingRequest(input: BrokerListingRequestInput) {
  const isChange = input.kind === "change";
  const subject = isChange
    ? `Listing change request — ${input.propertyAddress}`
    : `Withdrawal request — ${input.propertyAddress}`;
  const lead = isChange
    ? "A seller asked to change an active listing. Update Matrix first, then approve the request — it is not published until you do."
    : "A seller asked to withdraw their listing. Withdraw it in Matrix first, then approve the request.";
  const body = `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">${isChange ? "Listing change request" : "Withdrawal request"}</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${lead}</p>
    <p style="font-size:13px;line-height:1.7;color:#1c1c1c;"><strong>Address:</strong> ${escapeHtml(input.propertyAddress)}</p>
    ${input.summary ? `<p style="font-size:13px;line-height:1.7;color:#1c1c1c;"><strong>Changes:</strong> ${escapeHtml(input.summary)}</p>` : ""}
    ${input.reason ? `<p style="font-size:13px;line-height:1.7;color:#1c1c1c;"><strong>Reason:</strong> <em>${escapeHtml(input.reason)}</em></p>` : ""}
    ${button(input.reviewUrl, "Open the listing review →")}
  `;
  return send({
    to: input.to,
    subject,
    html: shell({ preheader: subject, body }),
    text: [subject, lead, `Address: ${input.propertyAddress}`, input.summary ? `Changes: ${input.summary}` : null, input.reason ? `Reason: ${input.reason}` : null, input.reviewUrl]
      .filter(Boolean)
      .join("\n"),
    idempotencyKey: `listing-request:${input.requestId}`,
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

// ─── Buyer showing requests (/api/showing-requests) ──────────────────
// Fase 1 del embudo del comprador. Ninguno de los dos emails confirma una visita.
// Fichas del feed IDX: el email del COMPRADOR no lleva datos de la ficha (pendiente de
// MIAMI, P3); el interno de la broker lleva solo el número de MLS.

export async function sendBrokerShowingRequest(input: {
  to: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  target: string;
  preferredTimes: string | null;
  message: string | null;
  otherAgentStatus: string;
  /** Con agente propio: su nombre y licencia. Sin agente: si aceptó el aviso NBR. */
  buyerAgent?: string | null;
  nbrNotice?: string | null;
  needsToSell: string | null;
  consentMarketing: boolean;
  consentVersion: string;
  /** Meta interna de primera respuesta (ISO). No es una promesa al comprador. */
  respondBy: string;
  lang: Lang;
  adminUrl: string;
}) {
  const e = escapeHtml;
  const subject = `New showing request: ${input.buyerName} (${input.target})`;
  const respondBy = new Date(input.respondBy).toLocaleString("en-US", {
    timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
  });
  const rows: [string, string][] = [
    ["Respond by", `${respondBy} ET (internal target; not promised to the buyer)`],
    ["Property", input.target],
    ["Buyer", input.buyerName],
    ["Email", input.buyerEmail],
    ["Phone", input.buyerPhone || "Not provided: contact by email"],
    ["Preferred times", input.preferredTimes || "—"],
    ["Other agent", input.otherAgentStatus],
    ...(input.buyerAgent ? ([["Buyer's agent", input.buyerAgent]] as [string, string][]) : []),
    ...(input.nbrNotice ? ([["NBR notice", input.nbrNotice]] as [string, string][]) : []),
    ["Needs to sell first", input.needsToSell || "—"],
    // Lo que el comprador autorizó, para no llamar ni escribir fuera de ese alcance.
    ["Consent", `Contact about this request by email or phone (no marketing, automated calls or texts) · text ${input.consentVersion}`],
    ["Marketing consent", input.consentMarketing ? "Yes" : "No: do not send marketing, automated calls or texts"],
    ["Language", input.lang],
  ];
  const body = `
    <p style="font-family:Georgia,serif;font-size:20px;line-height:1.4;color:#1c1c1c;margin:0 0 12px;">New showing request</p>
    <p style="font-size:14px;line-height:1.7;color:#1c1c1c;">Contact the buyer, verify prior representation and handle the written agreement before any tour. The showing is not confirmed.</p>
    <table cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:13px;color:#1c1c1c;">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#8a8268;text-transform:uppercase;font-size:10px;letter-spacing:0.18em;">${k}</td><td style="padding:4px 0;">${e(v)}</td></tr>`,
        )
        .join("")}
    </table>
    ${input.message ? `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;white-space:pre-wrap;">${e(input.message)}</p>` : ""}
    ${button(input.adminUrl, "Open buyer leads →")}
  `;
  return send({
    to: input.to,
    replyTo: input.buyerEmail,
    subject,
    html: shell({ preheader: subject, body }),
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${input.message ?? ""}\n\n${input.adminUrl}`,
  });
}

export async function sendShowingRequestReceived(input: {
  to: string;
  lang: Lang;
  buyerName: string;
  /** Solo para listings propios; null para fichas del feed IDX. */
  ownAddress: string | null;
}) {
  const isEs = input.lang === "es";
  const broker = BROKERAGE.brokerName.split(" ")[0];
  const subject = isEs ? "Recibimos tu solicitud de visita" : "We received your showing request";
  // Texto plano primero; el HTML lo escapa entero (nombre y dirección vienen del usuario).
  const interest = input.ownAddress ? (isEs ? ` por ${input.ownAddress}` : ` in ${input.ownAddress}`) : "";
  const lines = isEs
    ? [
        `Hola ${input.buyerName}, gracias por tu interés${interest}.`,
        `${broker}, nuestra broker licenciada, te contactará para coordinar.`,
        "Tu visita no está confirmada hasta que ella la confirme contigo.",
      ]
    : [
        `Hi ${input.buyerName}, thanks for your interest${interest}.`,
        `${broker}, our licensed broker, will contact you to coordinate.`,
        "Your showing is not confirmed until she confirms it with you.",
      ];
  const body = lines
    .map((l) => `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${escapeHtml(l)}</p>`)
    .join("");
  return send({
    to: input.to,
    subject,
    html: shell({ preheader: subject, body, lang: input.lang }),
    text: lines.join("\n\n"),
  });
}

// ─── Aviso NBR (No Brokerage Relationship, F.S. 475.278(4)) ───────────

/** Enlace para aceptar el aviso NBR antes de la visita (lo manda el admin o Loui). */
export async function sendNbrNoticeLink(input: { to: string; lang: Lang; buyerName: string | null; url: string; days: number }) {
  const isEs = input.lang === "es";
  const subject = isEs
    ? "Antes de tu visita: acepta el aviso de relación de corretaje"
    : "Before your showing: please accept the brokerage relationship notice";
  const hi = input.buyerName ? (isEs ? `Hola ${input.buyerName},` : `Hi ${input.buyerName},`) : isEs ? "Hola," : "Hi,";
  const lines = isEs
    ? [
        hi,
        "Como no tienes agente propio, la ley de Florida nos exige darte un aviso de ausencia de relación de corretaje (No Brokerage Relationship) antes de la visita.",
        `Léelo y acéptalo en este enlace (vence en ${input.days} días). Tu visita no está confirmada hasta que lo aceptes y la broker la confirme contigo.`,
      ]
    : [
        hi,
        "Since you don't have your own agent, Florida law requires us to give you a No Brokerage Relationship notice before the showing.",
        `Please read and accept it at this link (it expires in ${input.days} days). Your showing is not confirmed until you accept it and the broker confirms it with you.`,
      ];
  const body =
    lines.map((l) => `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${escapeHtml(l)}</p>`).join("") +
    button(input.url, isEs ? "Leer y aceptar el aviso" : "Read and accept the notice");
  return send({
    to: input.to,
    subject,
    html: shell({ preheader: subject, body, lang: input.lang }),
    text: [...lines, input.url].join("\n\n"),
  });
}

/** Copia en PDF del aviso aceptado, al comprador (en su idioma) o a la broker (inglés). */
export async function sendNbrNoticeAccepted(input: {
  to: string;
  lang: Lang;
  recipient: "buyer" | "broker";
  buyerName: string;
  listingLabel: string | null;
  pdf: Uint8Array;
  idempotencyKey: string;
}) {
  const isEs = input.lang === "es" && input.recipient === "buyer";
  const subject =
    input.recipient === "broker"
      ? `NBR notice accepted: ${input.buyerName}`
      : isEs
        ? "Tu copia del aviso de relación de corretaje"
        : "Your copy of the brokerage relationship notice";
  const where = input.listingLabel ? (isEs ? ` para ${input.listingLabel}` : ` for ${input.listingLabel}`) : "";
  const lines =
    input.recipient === "broker"
      ? [`${input.buyerName} accepted the No Brokerage Relationship notice${where}. The signed copy is attached.`]
      : isEs
        ? [
            `Hola ${input.buyerName}, adjuntamos la copia del aviso de ausencia de relación de corretaje que aceptaste${where}.`,
            "Tu visita no está confirmada hasta que la broker la confirme contigo.",
          ]
        : [
            `Hi ${input.buyerName}, attached is your copy of the No Brokerage Relationship notice you accepted${where}.`,
            "Your showing is not confirmed until the broker confirms it with you.",
          ];
  const body = lines.map((l) => `<p style="font-size:14px;line-height:1.7;color:#1c1c1c;">${escapeHtml(l)}</p>`).join("");
  return send({
    to: input.to,
    subject,
    html: shell({ preheader: subject, body, lang: isEs ? "es" : "en" }),
    text: lines.join("\n\n"),
    attachments: [{ filename: "lixtara-no-brokerage-relationship-notice.pdf", content: Buffer.from(input.pdf) }],
    idempotencyKey: input.idempotencyKey,
  });
}

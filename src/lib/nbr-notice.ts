// Aviso NBR (No Brokerage Relationship, F.S. 475.278(4)) para compradores sin agente.
//
// Decisión de la broker (2026-10-28): un comprador sin agente se atiende como No Brokerage
// Relationship. Antes de confirmar la visita acepta este aviso (475.278(4)(b): "before the
// showing of property"). Con agente, no se muestra el aviso: se piden el nombre y la licencia
// del agente.
//
// El texto en inglés es el de 475.278(4)(c), palabra por palabra (leg.state.fl.us, consultado
// el 2026-10-28), con el nombre de la entidad en el hueco "(insert name of Real Estate Entity
// and its Associates)". Es la versión que rige. La española es una traducción de cortesía.
// La primera oración va en mayúsculas y negrita (475.278(4)(b)).
//
// PENDIENTE DE REVISIÓN LEGAL: la versión lo dice. Cuando el abogado lo apruebe, cambia la
// versión (y con ella el hash que guarda la evidencia).
//
// PURO: sin I/O.

import { BROKERAGE } from "@/config/brokerage";

/** Versión del texto que ve el comprador; queda en cada aceptación. */
export const NBR_NOTICE_VERSION = "nbr-2026-10-29-pending-legal-review";

/** El texto no tiene todavía la revisión del abogado. */
export const NBR_LEGAL_REVIEW_PENDING = true;

/** Días para aceptar desde un enlace enviado por el admin o por Loui. */
export const NBR_LINK_DAYS = 14;

export interface NbrNoticeText {
  title: string;
  /** Primera oración: mayúsculas y negrita. */
  lead: string;
  intro: string;
  duties: readonly [string, string, string];
}

const ENTITY = `${BROKERAGE.legalName} and its Associates`;
const ENTITY_ES = `${BROKERAGE.legalName} y sus Asociados`;

/** 475.278(4)(c), tal cual. La que rige. */
export const NBR_NOTICE_EN: NbrNoticeText = {
  title: "NO BROKERAGE RELATIONSHIP NOTICE",
  lead: "FLORIDA LAW REQUIRES THAT REAL ESTATE LICENSEES WHO HAVE NO BROKERAGE RELATIONSHIP WITH A POTENTIAL SELLER OR BUYER DISCLOSE THEIR DUTIES TO SELLERS AND BUYERS.",
  intro: `As a real estate licensee who has no brokerage relationship with you, ${ENTITY} owe to you the following duties:`,
  duties: [
    "1. Dealing honestly and fairly;",
    "2. Disclosing all known facts that materially affect the value of residential real property which are not readily observable to the buyer.",
    "3. Accounting for all funds entrusted to the licensee.",
  ],
};

/** Traducción de cortesía (usted, como los documentos legales). No rige. */
export const NBR_NOTICE_ES: NbrNoticeText = {
  title: "AVISO DE AUSENCIA DE RELACIÓN DE CORRETAJE",
  lead: "LA LEY DE FLORIDA EXIGE QUE LOS LICENCIATARIOS DE BIENES RAÍCES QUE NO TIENEN UNA RELACIÓN DE CORRETAJE CON UN POSIBLE VENDEDOR O COMPRADOR DIVULGUEN SUS DEBERES A LOS VENDEDORES Y COMPRADORES.",
  intro: `Como licenciatario de bienes raíces que no tiene una relación de corretaje con usted, ${ENTITY_ES} le deben los siguientes deberes:`,
  duties: [
    "1. Tratar con honestidad y equidad;",
    "2. Divulgar todos los hechos conocidos que afecten materialmente el valor de la propiedad residencial y que el comprador no pueda observar fácilmente.",
    "3. Rendir cuentas de todos los fondos confiados al licenciatario.",
  ],
};

/** Línea de la columna en español: la traducción no rige. */
export const NBR_ES_GOVERNING_LINE = "Traducción de cortesía. Rige la versión en inglés.";

// ── Consentimiento E-SIGN (15 U.S.C. §7001(c)) ─────────────────────────────────────
// Antes del aviso. Cubre lo que pide §7001(c)(1): (B)(i) derecho a una copia en papel y a
// retirar el consentimiento, con sus consecuencias; (B)(ii) alcance: solo este aviso;
// (B)(iii) cómo retirarlo y cómo actualizar el contacto; (B)(iv) cómo pedir la copia en papel
// y su costo; (C)(i) requisitos técnicos. (C)(ii), poder acceder, lo muestra que el comprador
// lo acepta en la misma pantalla en la que lee el aviso. Va en la misma evidencia (versión y
// hash). PENDIENTE DE REVISIÓN LEGAL, como el aviso.

export const ESIGN_VERSION = "esign-2026-10-29-pending-legal-review";

export function esignConsentText(lang: string, contact: { email: string; phone: string }): string {
  return lang === "es"
    ? `Acepto recibir y firmar electrónicamente el aviso de ausencia de relación de corretaje (Ley E-SIGN, 15 U.S.C. §7001(c)). Este consentimiento cubre solo este aviso. Puede pedir una copia en papel, sin costo, en cualquier momento, escribiendo a ${contact.email} o llamando al ${contact.phone}. Puede retirar este consentimiento en cualquier momento por los mismos medios, sin costo; si lo retira antes de aceptar el aviso, se lo entregaremos en papel antes de la visita. Para actualizar su correo o teléfono, escríbanos a ${contact.email}. Para ver, firmar y guardar el aviso necesita un dispositivo con un navegador web actualizado, una cuenta de correo electrónico y un programa que abra archivos PDF, y poder guardarlos o imprimirlos.`
    : `I agree to receive and sign the No Brokerage Relationship notice electronically (E-SIGN Act, 15 U.S.C. §7001(c)). This consent covers only this notice. You may ask for a paper copy at no charge at any time by writing to ${contact.email} or calling ${contact.phone}. You may withdraw this consent at any time by the same means, at no charge; if you withdraw it before accepting the notice, we will give you the notice on paper before the showing. To update your email or phone, write to ${contact.email}. To view, sign and keep the notice you need a device with a current web browser, an email account and a program that opens PDF files, and the ability to save or print them.`;
}

export const NBR_COPY = {
  en: {
    heading: "Before your showing: No Brokerage Relationship notice",
    explain:
      "You told us you don't have your own agent, or you're not sure. Lixtara will not represent you as your agent. Florida law requires us to give you this notice before the showing.",
    esignTitle: "Consent to electronic delivery and signature",
    governingLabel: "English (governing)",
    spanishLabel: "Español (traducción de cortesía)",
    accept:
      "I have read the No Brokerage Relationship notice and I accept it. My full name and checking this box are my electronic signature.",
    signatureName: "Full name (your electronic signature)",
    phone: "Phone (optional)",
    submit: "Accept the notice",
    acceptedTitle: "Notice accepted",
    acceptedBody: "We emailed you a PDF copy. Your showing is not confirmed until the broker confirms it with you.",
    expired: "This link expired or was already used. Ask the broker to send you a new one.",
    // "No estoy seguro" (decisión del 28-oct): se trata como sin agente, con esta línea.
    haveAgentLine: "If you have an agreement with an agent, let us know so we can coordinate the showing with them.",
    verifyTitle: "Confirm your email",
    verifyBody: "Confirm that this is your email so the broker can coordinate your showing.",
    verifyButton: "Confirm my email",
    verifiedTitle: "Email confirmed",
    verifiedBody: "Thanks. The broker will contact you to coordinate the showing. It is not confirmed until she confirms it with you.",
    verifyExpired: "This link is no longer valid. If you already confirmed your email, there's nothing else to do.",
    agentName: "Your agent's name",
    agentBrokerage: "Your agent's brokerage",
    agentEmail: "Your agent's email",
    agentLicense: "Your agent's Florida license number",
    agentNote: "Since you have your own agent, the broker will coordinate the showing with your agent, and all communication will go through them.",
    errors: {
      nbr: "Please read and accept the No Brokerage Relationship notice.",
      esign: "Please accept receiving and signing the notice electronically.",
      agent: "Please enter your agent's name, brokerage, email and license number.",
      name: "Please type your full name.",
    },
  },
  es: {
    heading: "Antes de tu visita: aviso de ausencia de relación de corretaje",
    explain:
      "Nos dijiste que no tienes agente propio, o que no estás seguro. Lixtara no te representará como tu agente. La ley de Florida nos exige darte este aviso antes de la visita.",
    esignTitle: "Consentimiento para recibir y firmar electrónicamente",
    governingLabel: "English (governing)",
    spanishLabel: "Español (traducción de cortesía)",
    accept:
      "Leí el aviso de ausencia de relación de corretaje (No Brokerage Relationship) y lo acepto. Mi nombre completo y marcar esta casilla son mi firma electrónica.",
    signatureName: "Nombre completo (tu firma electrónica)",
    phone: "Teléfono (opcional)",
    submit: "Aceptar el aviso",
    acceptedTitle: "Aviso aceptado",
    acceptedBody: "Te enviamos una copia en PDF por correo. Tu visita no está confirmada hasta que la broker la confirme contigo.",
    expired: "Este enlace venció o ya se usó. Pídele a la broker que te envíe uno nuevo.",
    haveAgentLine: "Si tiene un acuerdo con un agente, avísenos para coordinar la visita con él.",
    verifyTitle: "Confirma tu correo",
    verifyBody: "Confirma que este es tu correo para que la broker coordine tu visita.",
    verifyButton: "Confirmar mi correo",
    verifiedTitle: "Correo confirmado",
    verifiedBody: "Gracias. La broker te contactará para coordinar la visita. No está confirmada hasta que ella la confirme contigo.",
    verifyExpired: "Este enlace ya no es válido. Si ya confirmaste tu correo, no tienes que hacer nada más.",
    agentName: "Nombre de tu agente",
    agentBrokerage: "Brokerage de tu agente",
    agentEmail: "Correo de tu agente",
    agentLicense: "Número de licencia de Florida de tu agente",
    agentNote: "Como tienes agente propio, la broker coordinará la visita con tu agente y toda la comunicación irá por él.",
    errors: {
      nbr: "Lee y acepta el aviso de ausencia de relación de corretaje.",
      esign: "Acepta recibir y firmar el aviso electrónicamente.",
      agent: "Escribe el nombre, el brokerage, el correo y el número de licencia de tu agente.",
      name: "Escribe tu nombre completo.",
    },
  },
} as const;

export function nbrCopy(lang: string) {
  return NBR_COPY[lang === "es" ? "es" : "en"];
}

/** Los dos textos, lado a lado y en este orden: inglés (rige) y español (cortesía). */
export function noticeTextsFor(): [NbrNoticeText, NbrNoticeText] {
  return [NBR_NOTICE_EN, NBR_NOTICE_ES];
}

/**
 * El texto plano exacto que se mostró: versiones, el consentimiento E-SIGN en el idioma de la
 * página y los dos textos del aviso (el hash va en nbr-notice.server.ts).
 */
export function noticePlainText(lang: string, contact: { email: string; phone: string }): string {
  const plain = (t: NbrNoticeText) => [t.title, t.lead, t.intro, ...t.duties].join("\n");
  return [
    NBR_NOTICE_VERSION,
    ESIGN_VERSION,
    esignConsentText(lang, contact),
    plain(NBR_NOTICE_EN),
    `${NBR_ES_GOVERNING_LINE}\n${plain(NBR_NOTICE_ES)}`,
  ].join("\n\n");
}

// ── Quién recibe el aviso ──────────────────────────────────────────────────────────

/** Respuesta del comprador a "¿firmaste un acuerdo con otro agente?". */
export type BuyerAgentStatus = "exclusive" | "non_exclusive" | "none" | "unsure";

/** Con agente (exclusivo o no): sin aviso NBR; se coordina con el agente. */
export function hasOwnAgent(status: string | null | undefined): boolean {
  return status === "exclusive" || status === "non_exclusive";
}

/** Sin agente, o sin saberlo (o sin respuesta): aviso NBR antes de la visita. */
export function needsNbrNotice(status: string | null | undefined): boolean {
  return !hasOwnAgent(status);
}

/** Licencia de Florida del agente: letras y números (SL o BK seguido de dígitos). */
export function normalizeAgentLicense(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{0,3}\d{4,10}$/.test(v) ? v : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BuyerAgent {
  name: string;
  brokerage: string;
  email: string;
  license: string;
}

/** Datos del agente del comprador (nombre, brokerage, correo y licencia), o null si falta algo. */
export function parseBuyerAgent(get: (k: string) => string | null | undefined): BuyerAgent | null {
  const name = (get("buyer_agent_name") ?? "").trim();
  const brokerage = (get("buyer_agent_brokerage") ?? "").trim();
  const email = (get("buyer_agent_email") ?? "").trim().toLowerCase();
  const license = normalizeAgentLicense(get("buyer_agent_license") ?? "");
  if (!name || name.length > 120 || !brokerage || brokerage.length > 160) return null;
  if (!EMAIL_RE.test(email) || email.length > 200 || !license) return null;
  return { name, brokerage, email, license };
}

export type NbrBlock = "nbr_notice_missing" | "nbr_email_unverified" | "nbr_buyer_agent_missing";

/**
 * Por qué una visita no se puede confirmar todavía (misma regla que el trigger
 * guard_showing_nbr de la base), o null:
 *   - con agente: hacen falta su nombre y su correo (toda la comunicación va por el agente);
 *   - sin agente: el aviso aceptado y el correo del comprador verificado.
 */
export function nbrBlockReason(input: {
  agentStatus: string | null | undefined;
  agentName: string | null | undefined;
  agentEmail: string | null | undefined;
  nbrAcceptedAt: string | null | undefined;
  emailVerifiedAt: string | null | undefined;
}): NbrBlock | null {
  if (hasOwnAgent(input.agentStatus)) {
    return input.agentName?.trim() && input.agentEmail?.trim() ? null : "nbr_buyer_agent_missing";
  }
  if (!input.nbrAcceptedAt) return "nbr_notice_missing";
  return input.emailVerifiedAt ? null : "nbr_email_unverified";
}

/** Fecha y hora de Miami (America/New_York), con la zona. */
export function formatNyDateTime(iso: string, lang: string): string {
  const s = new Date(iso).toLocaleString(lang === "es" ? "es-US" : "en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${s} ET (America/New_York)`;
}

/**
 * Para la ficha del admin: "Aviso NBR: aceptado [fecha] · correo verificado [fecha]",
 * "… · pendiente de verificación" o "Aviso NBR: pendiente". Con agente: null.
 */
export function nbrStatusLine(
  input: { agentStatus: string | null | undefined; acceptedAt: string | null; sentAt: string | null; emailVerifiedAt: string | null },
  lang: string,
): string | null {
  if (hasOwnAgent(input.agentStatus)) return null;
  const es = lang === "es";
  if (input.acceptedAt) {
    const verified = input.emailVerifiedAt
      ? `${es ? "correo verificado" : "email verified"} ${formatNyDateTime(input.emailVerifiedAt, lang)}`
      : es
        ? "pendiente de verificación del correo"
        : "pending email verification";
    return `${es ? "Aviso NBR: aceptado" : "NBR notice: accepted"} ${formatNyDateTime(input.acceptedAt, lang)} · ${verified}`;
  }
  if (input.sentAt) return `${es ? "Aviso NBR: pendiente (enviado" : "NBR notice: pending (sent"} ${formatNyDateTime(input.sentAt, lang)})`;
  return es ? "Aviso NBR: pendiente" : "NBR notice: pending";
}

/** Estado de la visita para la ficha (sin cambiar el estado guardado del lead). */
export function showingWaitLabel(
  input: { agentStatus: string | null | undefined; status: string; block: NbrBlock | null },
  lang: string,
): string | null {
  if (["showing_confirmed", "completed", "cancelled"].includes(input.status)) return null;
  const es = lang === "es";
  if (hasOwnAgent(input.agentStatus)) return es ? "Pendiente de coordinar con el agente del comprador" : "Pending coordination with the buyer's agent";
  if (input.block === "nbr_email_unverified") return es ? "Pendiente de verificación" : "Pending verification";
  return null;
}

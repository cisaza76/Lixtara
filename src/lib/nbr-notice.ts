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

export const NBR_COPY = {
  en: {
    heading: "Before your showing: No Brokerage Relationship notice",
    explain:
      "You told us you don't have your own agent, or you're not sure. Lixtara will not represent you as your agent. Florida law requires us to give you this notice before the showing.",
    courtesyNote: null as string | null,
    governingLabel: "English version (governing)",
    accept:
      "I have read the No Brokerage Relationship notice and I accept it. My full name and checking this box are my electronic signature.",
    signatureName: "Full name (your electronic signature)",
    phone: "Phone (optional)",
    submit: "Accept the notice",
    acceptedTitle: "Notice accepted",
    acceptedBody: "We emailed you a PDF copy. Your showing is not confirmed until the broker confirms it with you.",
    expired: "This link expired or was already used. Ask the broker to send you a new one.",
    agentName: "Your agent's name",
    agentLicense: "Your agent's Florida license number",
    agentNote: "Since you have your own agent, the broker will coordinate the showing with them.",
    errors: {
      nbr: "Please read and accept the No Brokerage Relationship notice.",
      agent: "Please enter your agent's name and license number.",
      name: "Please type your full name.",
    },
  },
  es: {
    heading: "Antes de tu visita: aviso de ausencia de relación de corretaje",
    explain:
      "Nos dijiste que no tienes agente propio, o que no estás seguro. Lixtara no te representará como tu agente. La ley de Florida nos exige darte este aviso antes de la visita.",
    courtesyNote: "Traducción de cortesía. La versión en inglés, más abajo, es la que rige.",
    governingLabel: "Versión en inglés (la que rige)",
    accept:
      "Leí el aviso de ausencia de relación de corretaje (No Brokerage Relationship) y lo acepto. Mi nombre completo y marcar esta casilla son mi firma electrónica.",
    signatureName: "Nombre completo (tu firma electrónica)",
    phone: "Teléfono (opcional)",
    submit: "Aceptar el aviso",
    acceptedTitle: "Aviso aceptado",
    acceptedBody: "Te enviamos una copia en PDF por correo. Tu visita no está confirmada hasta que la broker la confirme contigo.",
    expired: "Este enlace venció o ya se usó. Pídele a la broker que te envíe uno nuevo.",
    agentName: "Nombre de tu agente",
    agentLicense: "Número de licencia de Florida de tu agente",
    agentNote: "Como tienes agente propio, la broker coordinará la visita con tu agente.",
    errors: {
      nbr: "Lee y acepta el aviso de ausencia de relación de corretaje.",
      agent: "Escribe el nombre y el número de licencia de tu agente.",
      name: "Escribe tu nombre completo.",
    },
  },
} as const;

export function nbrCopy(lang: string) {
  return NBR_COPY[lang === "es" ? "es" : "en"];
}

/** Qué textos ve el comprador: siempre el inglés; en /es, además la traducción, primero. */
export function noticeTextsFor(lang: string): NbrNoticeText[] {
  return lang === "es" ? [NBR_NOTICE_ES, NBR_NOTICE_EN] : [NBR_NOTICE_EN];
}

/** El texto plano exacto que se mostró (el hash va en nbr-notice.server.ts). */
export function noticePlainText(lang: string): string {
  const plain = (t: NbrNoticeText) => [t.title, t.lead, t.intro, ...t.duties].join("\n");
  return [NBR_NOTICE_VERSION, ...noticeTextsFor(lang).map(plain)].join("\n\n");
}

// ── Quién recibe el aviso ──────────────────────────────────────────────────────────

/** Respuesta del comprador a "¿firmaste un acuerdo con otro agente?". */
export type BuyerAgentStatus = "exclusive" | "non_exclusive" | "none" | "unsure";

/** Con agente (exclusivo o no): sin aviso NBR, con nombre y licencia del agente. */
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

/**
 * Por qué una visita no se puede confirmar todavía por el aviso NBR o los datos del agente
 * (misma regla que el trigger guard_showing_nbr de la base), o null.
 */
export function nbrBlockReason(input: {
  agentStatus: string | null | undefined;
  agentName: string | null | undefined;
  agentLicense: string | null | undefined;
  nbrAcceptedAt: string | null | undefined;
}): "nbr_notice_missing" | "nbr_buyer_agent_missing" | null {
  if (hasOwnAgent(input.agentStatus)) {
    return input.agentName?.trim() && input.agentLicense?.trim() ? null : "nbr_buyer_agent_missing";
  }
  return input.nbrAcceptedAt ? null : "nbr_notice_missing";
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

/** "Aviso NBR: aceptado [fecha]" / "pendiente" para la ficha del admin. */
export function nbrStatusLine(
  input: { agentStatus: string | null | undefined; acceptedAt: string | null; sentAt: string | null },
  lang: string,
): string | null {
  if (hasOwnAgent(input.agentStatus)) return null;
  const es = lang === "es";
  if (input.acceptedAt) return `${es ? "Aviso NBR: aceptado" : "NBR notice: accepted"} ${formatNyDateTime(input.acceptedAt, lang)}`;
  if (input.sentAt) return `${es ? "Aviso NBR: pendiente (enviado" : "NBR notice: pending (sent"} ${formatNyDateTime(input.sentAt, lang)})`;
  return es ? "Aviso NBR: pendiente" : "NBR notice: pending";
}

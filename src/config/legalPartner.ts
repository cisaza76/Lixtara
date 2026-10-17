// Servicios legales: Lixtara LLC es una brokerage, no una firma de abogados. No vende, no
// cobra, no incluye en sus planes ni factura servicios legales (Florida Bar 4-5.4 y 4-5.5).
// Un abogado inmobiliario de Florida, con su propia firma independiente, presta esos
// servicios; el cliente lo contrata y le paga DIRECTAMENTE. Lixtara solo refiere, sin recibir
// pago por el referido (decisión del owner, 2026-10-16).
//
// Única fuente para todo texto sobre el abogado: planes, FAQ, consultas, servicios, Términos,
// la divulgación (LegalServicesDisclosure) y Loui. Nunca se muestra una tarifa del abogado:
// las fija y publica la firma.

import { BROKERAGE } from "@/config/brokerage";

export const legalPartner = {
  /** true solo cuando el abogado apruebe los textos. */
  enabled: false,
  /** Nombre legal de la firma (PA / PLLC). Vacío = texto genérico. */
  firmName: process.env.NEXT_PUBLIC_LEGAL_PARTNER_NAME?.trim() ?? "",
  /** Web o página de agenda de la firma. */
  url: process.env.NEXT_PUBLIC_LEGAL_PARTNER_URL?.trim() ?? "",
  /** Paquete legal de Concierge: false hasta que la firma lo defina. */
  packageEnabled: false,
} as const;

type Lang = "en" | "es";

/** Solo con la firma aprobada y una URL https: si no, ningún botón ni enlace a la firma. */
export function legalPartnerLink(): string | null {
  return legalPartner.enabled && /^https:\/\/[^\s]+$/.test(legalPartner.url) ? legalPartner.url : null;
}

/** "an independent Florida real estate attorney" o el nombre de la firma. */
function attorneyRef(lang: Lang): string {
  if (legalPartner.firmName) return legalPartner.firmName;
  return lang === "es" ? "un abogado inmobiliario independiente en Florida" : "an independent Florida real estate attorney";
}

/** Bullet de los planes Essentials y Pro (y de Concierge sin paquete). Termina en "*". */
export function legalReferralBullet(lang: Lang): string {
  return lang === "es"
    ? `¿Necesitas abogado? Te referimos a ${attorneyRef(lang)}. Tú lo contratas y le pagas directamente a la firma.*`
    : `Need a lawyer? We'll refer you to ${attorneyRef(lang)}. You hire and pay the law firm directly.*`;
}

/** Bullet legal de Concierge: el paquete opcional solo si la firma lo definió. */
export function conciergeLegalBullet(lang: Lang): string {
  if (!legalPartner.packageEnabled) return legalReferralBullet(lang);
  return lang === "es"
    ? `Paquete legal opcional con ${attorneyRef(lang)}. Contrato aparte, facturado directamente por la firma; no está incluido en la tarifa de Lixtara.*`
    : `Optional legal package from ${attorneyRef(lang)}. Separate agreement, billed directly by the law firm, not included in Lixtara's fee.*`;
}

/** Divulgación completa (LegalServicesDisclosure, Términos, Loui). */
export function legalServicesDisclosure(lang: Lang): string {
  const firm =
    legalPartner.firmName ||
    (lang === "es" ? "una firma de abogados independiente de Florida" : "an independent Florida law firm");
  return lang === "es"
    ? `${BROKERAGE.legalName} es una brokerage inmobiliaria con licencia, no una firma de abogados, y no presta asesoría legal. Los servicios legales los presta exclusivamente ${firm}, que no es propiedad de Lixtara ni está bajo su control. Firmas tu propio contrato con la firma y le pagas directamente. Lixtara no recibe ningún pago por referirte y puedes elegir libremente a cualquier abogado.`
    : `${BROKERAGE.legalName} is a licensed real estate brokerage, not a law firm, and does not provide legal advice. Legal services are provided solely by ${firm}, which is not owned or controlled by Lixtara. You sign your own agreement with the firm and pay it directly. Lixtara receives no payment for referring you, and you are free to choose any attorney.`;
}

/** Nota junto al enlace externo a la firma. */
export function legalPartnerLinkNote(lang: Lang): string {
  return lang === "es" ? "Abre el sitio de la firma de abogados" : "Opens the law firm's website";
}

/** Ancla de la divulgación en las páginas con planes (el "*" de los bullets enlaza aquí). */
export const LEGAL_DISCLOSURE_ANCHOR = "legal-services-disclosure";

/** Respuesta de la FAQ "¿Lixtara me da un abogado?" (EN/ES, sin tarifas). */
export function legalFaqAnswer(lang: Lang): string {
  return lang === "es"
    ? `No. Lixtara es una brokerage inmobiliaria, no una firma de abogados, y ningún plan incluye abogado. Si lo necesitas, te referimos a ${attorneyRef(lang)}. Tú lo contratas y le pagas directamente a la firma, y Lixtara no recibe nada por el referido. Puedes elegir a cualquier abogado.`
    : `No. Lixtara is a real estate brokerage, not a law firm, and no plan includes a lawyer. If you need one, we'll refer you to ${attorneyRef(lang)}. You hire and pay the law firm directly, and Lixtara receives nothing for the referral. You're free to choose any attorney.`;
}

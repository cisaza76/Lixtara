// Buyer leads: solicitudes de visita atendidas por una Realtor real.
//
// Fase 1 del embudo del comprador (docs/planning/2026-10-compradores/, roadmap M3):
// el comprador SOLICITA una visita; la broker lo contacta, verifica si ya tiene
// representación, explica las condiciones y gestiona el acuerdo escrito antes de cualquier
// tour. Nada aquí confirma una visita ni firma un acuerdo.
//
// Los estados y la regla de acuerdo están duplicados a propósito en la base
// (migración 20261011150000): la base RECHAZA la escritura; esto da el mensaje claro antes
// de intentarla. buyer-leads.test.ts verifica que ambas listas coinciden.
//
// PURO: sin I/O.

export const LEAD_STATUSES = [
  "received",
  "contact_pending",
  "contacted",
  "agreement_pending",
  "agreement_signed",
  "showing_coordinating",
  "showing_confirmed",
  "completed",
  "cancelled",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  received: "Request received",
  contact_pending: "Contact pending",
  contacted: "Contacted",
  agreement_pending: "Agreement pending",
  agreement_signed: "Agreement signed",
  showing_coordinating: "Showing in coordination",
  showing_confirmed: "Showing confirmed",
  completed: "Showing completed",
  cancelled: "Cancelled",
};

/**
 * Estados del embudo de mayo de 2026 (commit d5f9865): new → contacted → qualified →
 * assigned (a un agente aliado) → closed (OPERACIÓN CERRADA) / lost. Las filas viejas los
 * conservan (`source = 'legacy'`); no se convierten solos porque cambiaría su significado.
 */
export const LEGACY_ONLY_STATUSES = ["new", "qualified", "assigned", "closed", "lost"] as const;

/** Reclasificación manual de una fila histórica: solo hacia el inicio del embudo. */
const LEGACY_TARGETS: readonly LeadStatus[] = ["received", "contact_pending", "contacted", "cancelled"];

/**
 * Transiciones permitidas. Flexibles donde la operación real lo es (la coordinación de la
 * visita puede empezar antes de la firma), estrictas donde hay una obligación: ningún
 * camino lleva a "confirmada" o "completada" sin pasar por la regla de acuerdo.
 */
const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  received: ["contact_pending", "contacted", "cancelled"],
  contact_pending: ["contacted", "cancelled"],
  contacted: ["agreement_pending", "agreement_signed", "showing_coordinating", "cancelled"],
  agreement_pending: ["agreement_signed", "showing_coordinating", "cancelled"],
  agreement_signed: ["showing_coordinating", "showing_confirmed", "cancelled"],
  showing_coordinating: ["agreement_pending", "agreement_signed", "showing_confirmed", "cancelled"],
  showing_confirmed: ["showing_coordinating", "completed", "cancelled"],
  completed: [],
  cancelled: ["contact_pending"],
};

export function isLegacyOnlyStatus(v: unknown): boolean {
  return typeof v === "string" && (LEGACY_ONLY_STATUSES as readonly string[]).includes(v);
}

export function nextStatuses(from: string): readonly LeadStatus[] {
  if (isLegacyOnlyStatus(from)) return LEGACY_TARGETS;
  return isLeadStatus(from) ? TRANSITIONS[from] : [];
}

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);
}

/** Estados que exigen el cumplimiento contractual registrado (igual que en la base). */
export const AGREEMENT_REQUIRED_STATUSES: readonly LeadStatus[] = [
  "agreement_signed",
  "showing_confirmed",
  "completed",
];

export const AGREEMENT_TYPES = [
  "showing_agreement",
  "exclusive_buyer_brokerage",
  "other_written",
  "not_required",
] as const;
export type AgreementType = (typeof AGREEMENT_TYPES)[number];

export const AGREEMENT_TYPE_LABELS: Record<AgreementType, string> = {
  showing_agreement: "Showing agreement",
  exclusive_buyer_brokerage: "Exclusive buyer brokerage agreement",
  other_written: "Other written agreement",
  not_required: "Not required (catalog reason, own listings only)",
};

/**
 * Catálogo CERRADO de motivos para `not_required`, pendiente de validación del abogado.
 * Solo aplica a listings PROPIOS de Lixtara: en fichas de otros brokers siempre hace falta
 * un acuerdo escrito. Ampliarlo exige cambiar también la migración (la base lo aplica).
 */
export const AGREEMENT_EXCEPTION_CODES = [
  "open_house_seller_side",
  "unrepresented_buyer_own_listing",
] as const;
export type AgreementExceptionCode = (typeof AGREEMENT_EXCEPTION_CODES)[number];

export const AGREEMENT_EXCEPTION_LABELS: Record<AgreementExceptionCode, string> = {
  open_house_seller_side: "Open house of a Lixtara listing, hosted for the seller",
  unrepresented_buyer_own_listing: "Unrepresented buyer on a Lixtara listing (seller side only)",
};

export interface AgreementRecord {
  agreement_type: string | null;
  agreement_recorded_at: string | null;
  agreement_exception_code: string | null;
  property_id: string | null;
}

/** Misma regla que las restricciones de la base (exception_rule + before_showing). */
export function agreementRequirementMet(a: AgreementRecord): boolean {
  if (!a.agreement_recorded_at || !a.agreement_type) return false;
  if (!(AGREEMENT_TYPES as readonly string[]).includes(a.agreement_type)) return false;
  if (a.agreement_type === "not_required") {
    return (
      (AGREEMENT_EXCEPTION_CODES as readonly string[]).includes(a.agreement_exception_code ?? "") &&
      !!a.property_id
    );
  }
  return true;
}

export type TransitionError =
  | "invalid_status"
  | "invalid_transition"
  | "agreement_missing"
  | "signed_needs_written";

export function checkTransition(
  lead: AgreementRecord & { status: string },
  next: string,
): { ok: true; status: LeadStatus } | { ok: false; error: TransitionError } {
  if (!isLeadStatus(next)) return { ok: false, error: "invalid_status" };
  if (!isLeadStatus(lead.status) && !isLegacyOnlyStatus(lead.status)) return { ok: false, error: "invalid_status" };
  if (!nextStatuses(lead.status).includes(next)) return { ok: false, error: "invalid_transition" };
  if (AGREEMENT_REQUIRED_STATUSES.includes(next) && !agreementRequirementMet(lead)) {
    return { ok: false, error: "agreement_missing" };
  }
  if (next === "agreement_signed" && lead.agreement_type === "not_required") {
    return { ok: false, error: "signed_needs_written" };
  }
  return { ok: true, status: next };
}

// ── Formulario público "Solicitar visita con Lixtara" ──────────────────────────────

export const OTHER_AGENT_OPTIONS = ["exclusive", "non_exclusive", "none", "unsure"] as const;
export type OtherAgentStatus = (typeof OTHER_AGENT_OPTIONS)[number];
export const NEEDS_TO_SELL_OPTIONS = ["yes", "no", "maybe"] as const;
export type NeedsToSell = (typeof NEEDS_TO_SELL_OPTIONS)[number];

/**
 * Versión del texto de consentimiento que vio el comprador. Identifica el texto EXACTO
 * (y por tanto su alcance) en `showingRequest.consentContact` / `consentMarketing` de
 * src/lib/i18n.ts. Cada cambio de esos textos sube la versión. Los definitivos (TCPA /
 * Florida Telemarketing Act) están pendientes del abogado.
 *   draft-1 · 2026-10-10 · primer borrador.
 *   draft-2 · 2026-10-11 · el operativo excluye marketing, llamadas automáticas y SMS.
 */
export const CONSENT_VERSION = "2026-10-draft-2";

// Sin plazo de respuesta prometido: el SLA no está confirmado con la broker (decisión del
// owner, 2026-10-11). Ni el formulario ni los emails al comprador mencionan horas.

export type ShowingTarget =
  | { kind: "mls"; listingKey: string }
  | { kind: "own"; propertyId: string };

export interface ShowingRequest {
  target: ShowingTarget;
  fullName: string;
  email: string;
  phone: string | null;
  preferredTimes: string | null;
  message: string | null;
  otherAgentStatus: OtherAgentStatus;
  needsToSell: NeedsToSell | null;
  consentMarketing: boolean;
  lang: "en" | "es";
}

export type ShowingRequestError =
  | "spam"
  | "target"
  | "required"
  | "email"
  | "phone"
  | "too_long"
  | "consent";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LISTING_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Teléfono OPCIONAL, normalizado a E.164 cuando viene:
 *   - con "+": 8 a 15 dígitos (cualquier país).
 *   - sin "+": 10 dígitos (EE. UU.) → +1…, u 11 que empiezan por 1 → +1….
 * Separadores comunes (espacios, guiones, puntos, paréntesis) se ignoran. Dar un teléfono
 * NO autoriza marketing, llamadas automáticas ni SMS: eso es `consent_marketing`.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[0-9 ().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

const truthy = (v: string | null | undefined) => v === "true" || v === "on" || v === "1";

/**
 * Valida la solicitud. `get` lee un campo (FormData o JSON). Todo lo que no está en una
 * lista cerrada se rechaza; los textos libres se recortan y se limitan.
 */
export function parseShowingRequest(
  get: (key: string) => string | null | undefined,
): { ok: true; data: ShowingRequest } | { ok: false; error: ShowingRequestError } {
  // Honeypot: un campo oculto que una persona nunca llena.
  if ((get("website") ?? "").trim() !== "") return { ok: false, error: "spam" };

  const listingKey = (get("listing_key") ?? "").trim();
  const propertyId = (get("property_id") ?? "").trim();
  let target: ShowingTarget;
  if (listingKey && !propertyId && LISTING_KEY_RE.test(listingKey)) {
    target = { kind: "mls", listingKey };
  } else if (propertyId && !listingKey && UUID_RE.test(propertyId)) {
    target = { kind: "own", propertyId };
  } else {
    return { ok: false, error: "target" };
  }

  const fullName = (get("full_name") ?? "").trim();
  const email = (get("email") ?? "").trim().toLowerCase();
  const phone = (get("phone") ?? "").trim();
  const preferredTimes = (get("preferred_times") ?? "").trim();
  const message = (get("message") ?? "").trim();
  const otherAgent = (get("other_agent_status") ?? "").trim();
  const needsToSell = (get("needs_to_sell") ?? "").trim();
  const lang = get("lang") === "es" ? "es" : "en";

  if (!fullName || !email || !(OTHER_AGENT_OPTIONS as readonly string[]).includes(otherAgent)) {
    return { ok: false, error: "required" };
  }
  if (fullName.length > 120 || email.length > 200 || preferredTimes.length > 300 || message.length > 1000) {
    return { ok: false, error: "too_long" };
  }
  if (!EMAIL_RE.test(email)) return { ok: false, error: "email" };
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (phone && !normalizedPhone) return { ok: false, error: "phone" };
  if (!truthy(get("consent_contact"))) return { ok: false, error: "consent" };

  return {
    ok: true,
    data: {
      target,
      fullName,
      email,
      phone: normalizedPhone,
      preferredTimes: preferredTimes || null,
      message: message || null,
      otherAgentStatus: otherAgent as OtherAgentStatus,
      needsToSell: (NEEDS_TO_SELL_OPTIONS as readonly string[]).includes(needsToSell)
        ? (needsToSell as NeedsToSell)
        : null,
      consentMarketing: truthy(get("consent_marketing")),
      lang,
    },
  };
}

/**
 * Comprador con acuerdo EXCLUSIVO con otro broker: Lixtara no firma ni coordina la visita
 * (Código de Ética, art. 16). El lead se registra cancelado, con el motivo, para medirlo.
 */
export function initialStatusFor(r: ShowingRequest): { status: LeadStatus; cancelReason: string | null } {
  return r.otherAgentStatus === "exclusive"
    ? { status: "cancelled", cancelReason: "Buyer reported an exclusive agreement with another brokerage" }
    : { status: "received", cancelReason: null };
}

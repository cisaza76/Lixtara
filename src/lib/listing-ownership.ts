// Titular del listing y segundo firmante vendedor (#220). Puro: lo usan el paso 3 (formulario y
// server action), la completitud del paso 3 y la creación del acuerdo.
//
// Tablas (migración 20261028120000): listing_ownership (una fila por listing) y
// listing_additional_signers (v1: uno por listing). La base también valida (checks, trigger
// guard_listing_signers); estas reglas dan el mensaje por campo antes.
//
// Reglas (owner, 2026-10-21 y 2026-10-27):
//   - Personas físicas: "¿Hay otra persona en el título?" y "¿Es el homestead de un dueño
//     casado?". Cualquiera de las dos con sí exige el segundo firmante (c): sin él, el paso 3 no
//     avanza y el acuerdo no se crea.
//   - Los dos sí son 3 firmantes (dos en el título + el cónyuge) → revisión manual
//     (three_or_more_owners), no autoservicio (b). Salvo que la otra persona del título SEA el
//     cónyuge: entonces firman dos (el cónyuge ya firma como titular).
//   - LLC o corporación de Florida: un firmante (el vendedor) con nombre de la entidad, cargo y
//     la casilla de autoridad.
//   - Revisión manual (entidad no registrada en Florida, trust, sucesión, 3+ dueños, poder): sin
//     acuerdo automático hasta que la broker lo destrabe (manual_review_cleared_at).
//   - El segundo firmante necesita su propio correo, distinto del del vendedor.

export const OWNER_KINDS = ["individuals", "fl_entity", "manual_review"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const MANUAL_REVIEW_REASONS = ["non_fl_entity", "trust", "estate", "three_or_more_owners", "poa"] as const;
export type ManualReviewReason = (typeof MANUAL_REVIEW_REASONS)[number];

export const SIGNER_RELATIONSHIPS = ["title_holder", "homestead_spouse"] as const;
export type SignerRelationship = (typeof SIGNER_RELATIONSHIPS)[number];

/** Rol del segundo vendedor en la plantilla del acuerdo (v4 en adelante). */
export const SECOND_SELLER_ROLE = "Seller 2";

/** Plazo para que firmen todos los vendedores (owner, 2026-10-21). */
export const SIGNING_DEADLINE_DAYS = 7;
/** Recordatorios de DocuSign al segundo firmante: a los 2 días y luego cada 3 (día 5). */
export const SIGNING_REMINDER_FIRST_DAY = 2;
export const SIGNING_REMINDER_EVERY_DAYS = 3;

/** Lo que el paso 3 guarda en listing_ownership (solo columnas del vendedor). */
export interface OwnershipRow {
  owner_kind: OwnerKind;
  other_title_holders: boolean;
  married_homestead: boolean;
  entity_name: string | null;
  entity_signer_title: string | null;
  entity_authority_confirmed_at: string | null;
  manual_review_reason: ManualReviewReason | null;
}

/** Lo que el paso 3 guarda en listing_additional_signers. */
export interface SignerRow {
  relationship: SignerRelationship;
  full_name: string;
  email: string;
  permission_confirmed_at: string;
}

export type OwnershipError =
  | "owner_kind_required"
  | "title_answer_required"
  | "homestead_answer_required"
  | "spouse_answer_required"
  | "signer_name_required"
  | "signer_email_invalid"
  | "signer_same_email"
  | "signer_permission_required"
  | "entity_name_required"
  | "entity_title_required"
  | "entity_authority_required"
  | "manual_review_reason_required";

/** Código de error del paso 3 → su texto en stepErrors (EN/ES). */
export const OWNERSHIP_ERROR_COPY = {
  owner_kind_required: "ownerKindRequired",
  title_answer_required: "titleAnswerRequired",
  homestead_answer_required: "homesteadAnswerRequired",
  spouse_answer_required: "spouseAnswerRequired",
  signer_name_required: "signerNameRequired",
  signer_email_invalid: "signerEmailInvalid",
  signer_same_email: "signerSameEmail",
  signer_permission_required: "signerPermissionRequired",
  entity_name_required: "entityNameRequired",
  entity_title_required: "entityTitleRequired",
  entity_authority_required: "entityAuthorityRequired",
  manual_review_reason_required: "manualReviewReasonRequired",
} as const satisfies Record<OwnershipError, string>;

/** Campo del formulario de cada error (analítica: nunca el valor). */
export const OWNERSHIP_ERROR_FIELD: Record<OwnershipError, string> = {
  owner_kind_required: "owner_kind",
  title_answer_required: "other_title_holders",
  homestead_answer_required: "married_homestead",
  spouse_answer_required: "co_owner_is_spouse",
  signer_name_required: "signer_full_name",
  signer_email_invalid: "signer_email",
  signer_same_email: "signer_email",
  signer_permission_required: "signer_permission",
  entity_name_required: "entity_name",
  entity_title_required: "entity_signer_title",
  entity_authority_required: "entity_authority",
  manual_review_reason_required: "manual_review_reason",
};

export function isOwnershipError(code: string | null | undefined): code is OwnershipError {
  return !!code && Object.hasOwn(OWNERSHIP_ERROR_COPY, code);
}

export type ParsedOwnership =
  | { ok: true; ownership: OwnershipRow; signer: SignerRow | null }
  | { ok: false; error: OwnershipError };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const norm = (s: string) => s.trim().toLowerCase();

/** ¿Los dos correos son el mismo para firmar? Sin distinguir mayúsculas ni espacios. */
export function sameSignerEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && norm(a) === norm(b);
}

const yesNo = (v: unknown): boolean | null => (v === "yes" ? true : v === "no" ? false : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Campos del formulario del paso 3 (FormData.get). */
export type OwnershipFormGetter = (name: string) => unknown;

/**
 * Lee la sección "Titular" del paso 3. `sellerEmail`: el correo de la cuenta del vendedor (el
 * segundo firmante necesita otro). `now`: marca de las casillas confirmadas.
 */
export function parseOwnershipForm(get: OwnershipFormGetter, sellerEmail: string | null, now: Date): ParsedOwnership {
  const at = now.toISOString();
  const kind = text(get("owner_kind"));
  if (!(OWNER_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "owner_kind_required" };
  const base = { other_title_holders: false, married_homestead: false, entity_name: null, entity_signer_title: null, entity_authority_confirmed_at: null, manual_review_reason: null };

  if (kind === "manual_review") {
    const reason = text(get("manual_review_reason"));
    if (!(MANUAL_REVIEW_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "manual_review_reason_required" };
    return { ok: true, ownership: { ...base, owner_kind: "manual_review", manual_review_reason: reason as ManualReviewReason }, signer: null };
  }

  if (kind === "fl_entity") {
    const name = text(get("entity_name"));
    const title = text(get("entity_signer_title"));
    if (name.length < 2 || name.length > 200) return { ok: false, error: "entity_name_required" };
    if (title.length < 2 || title.length > 80) return { ok: false, error: "entity_title_required" };
    if (get("entity_authority") !== "1") return { ok: false, error: "entity_authority_required" };
    return { ok: true, ownership: { ...base, owner_kind: "fl_entity", entity_name: name, entity_signer_title: title, entity_authority_confirmed_at: at }, signer: null };
  }

  const otherOnTitle = yesNo(get("other_title_holders"));
  if (otherOnTitle === null) return { ok: false, error: "title_answer_required" };
  const homestead = yesNo(get("married_homestead"));
  if (homestead === null) return { ok: false, error: "homestead_answer_required" };
  const answers = { other_title_holders: otherOnTitle, married_homestead: homestead };

  if (otherOnTitle && homestead) {
    // ¿El otro titular es el cónyuge? Sí → dos firmantes; no → tres (revisión manual).
    const spouse = yesNo(get("co_owner_is_spouse"));
    if (spouse === null) return { ok: false, error: "spouse_answer_required" };
    if (!spouse) {
      return { ok: true, ownership: { ...base, ...answers, owner_kind: "manual_review", manual_review_reason: "three_or_more_owners" }, signer: null };
    }
  }
  if (!otherOnTitle && !homestead) {
    return { ok: true, ownership: { ...base, ...answers, owner_kind: "individuals" }, signer: null };
  }

  const fullName = text(get("signer_full_name"));
  const email = text(get("signer_email"));
  if (fullName.length < 2 || fullName.length > 120) return { ok: false, error: "signer_name_required" };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "signer_email_invalid" };
  if (sameSignerEmail(email, sellerEmail)) return { ok: false, error: "signer_same_email" };
  if (get("signer_permission") !== "1") return { ok: false, error: "signer_permission_required" };
  return {
    ok: true,
    ownership: { ...base, ...answers, owner_kind: "individuals" },
    signer: { relationship: otherOnTitle ? "title_holder" : "homestead_spouse", full_name: fullName, email, permission_confirmed_at: at },
  };
}

/** Lo guardado en la base, para la completitud y el acuerdo. */
export interface StoredOwnership {
  owner_kind: string;
  other_title_holders: boolean;
  married_homestead: boolean;
  manual_review_reason: string | null;
  manual_review_cleared_at: string | null;
}
export interface StoredSigner {
  full_name: string;
  email: string;
  relationship: string;
}

export type SignerPlan =
  | { ok: true; sellersRequired: 1 | 2; signer: StoredSigner | null }
  | { ok: false; error: "ownership_missing" | "signer_required" | "manual_review" | "signer_same_email" };

/**
 * Quién firma el acuerdo, según lo guardado. Lo usan la completitud del paso 3 y
 * /api/agreement/create, que inserta con service_role (sin la política de la base): por eso
 * aquí sellersRequired = 1 + firmantes guardados y las reglas (c) y del correo.
 */
export function signerPlan(ownership: StoredOwnership | null, signers: StoredSigner[], sellerEmail: string | null): SignerPlan {
  if (!ownership || !(OWNER_KINDS as readonly string[]).includes(ownership.owner_kind)) return { ok: false, error: "ownership_missing" };
  if (ownership.owner_kind === "manual_review" && !ownership.manual_review_cleared_at) return { ok: false, error: "manual_review" };
  const needsSigner = ownership.owner_kind === "individuals" && (ownership.other_title_holders || ownership.married_homestead);
  if (needsSigner && signers.length === 0) return { ok: false, error: "signer_required" };
  // Sin titular ni homestead no hay segundo firmante (uno que quedó guardado no firma).
  const signer = needsSigner ? signers[0] : null;
  if (signer && sameSignerEmail(signer.email, sellerEmail)) return { ok: false, error: "signer_same_email" };
  return { ok: true, sellersRequired: signer ? 2 : 1, signer };
}

/** El paso 3 está completo en lo del titular (la revisión manual también: el dato está). */
export function ownershipStepComplete(ownership: StoredOwnership | null, signers: StoredSigner[]): boolean {
  if (!ownership || !(OWNER_KINDS as readonly string[]).includes(ownership.owner_kind)) return false;
  if (ownership.owner_kind === "manual_review") return !!ownership.manual_review_reason;
  const r = signerPlan(ownership, signers, null);
  return r.ok;
}

/** L2 del acuerdo: "Ana Pérez and Luis Pérez" con dos vendedores. */
export function agreementSellerNames(sellerName: string, signer: StoredSigner | null): string {
  return signer ? `${sellerName} and ${signer.full_name.trim()}` : sellerName;
}

/**
 * Campos del acuerdo que guarda /api/agreement/create (con service_role). La política de la base
 * (sellers_required = 1 + firmantes guardados) no corre con esa clave: se valida aquí. Un firmante
 * guardado que ya no corresponde (el paso 3 lo borra al contestar que no) también es un desajuste.
 */
export function agreementSignerFields(
  plan: Extract<SignerPlan, { ok: true }>,
  storedSigners: number,
  now: Date,
): { ok: true; fields: { sellers_required: 1 | 2; signing_deadline_at: string | null } } | { ok: false } {
  if (plan.sellersRequired !== 1 + storedSigners) return { ok: false };
  return {
    ok: true,
    fields: {
      sellers_required: plan.sellersRequired,
      signing_deadline_at:
        plan.sellersRequired === 2 ? new Date(now.getTime() + SIGNING_DEADLINE_DAYS * 86_400_000).toISOString() : null,
    },
  };
}

/**
 * Patrón HTML (bandera v) que rechaza el correo del vendedor, sin distinguir mayúsculas y con
 * espacios alrededor: el navegador muestra "Cada firmante necesita su propio correo…" en el
 * mismo intento que los demás errores. Sin correo del vendedor, cualquier valor.
 */
export function notSellerEmailPattern(sellerEmail: string | null | undefined): string | undefined {
  const e = (sellerEmail ?? "").trim();
  if (!e) return undefined;
  const SYNTAX = new Set([..."^$\\.*+?()[]{}|/"]);
  const chars = [...e].map((c) => {
    const lo = c.toLowerCase();
    const up = c.toUpperCase();
    if (lo !== up) return `[${lo}${up}]`;
    return SYNTAX.has(c) ? `\\${c}` : c;
  });
  return String.raw`(?!\s*${chars.join("")}\s*$).*`;
}

type YesNo = "yes" | "no" | "";

/** Valores iniciales del formulario del paso 3, desde lo guardado. */
export interface OwnershipFormInitial {
  kind: OwnerKind | "";
  otherOnTitle: YesNo;
  homestead: YesNo;
  /** Con los dos sí: "no" = tres firmantes (guardado como revisión manual). */
  coOwnerIsSpouse: YesNo;
  signerName: string;
  signerEmail: string;
  signerPermission: boolean;
  entityName: string;
  entitySignerTitle: string;
  entityAuthority: boolean;
  manualReason: ManualReviewReason | "";
}

export function ownershipFormInitial(
  o: (StoredOwnership & { entity_name?: string | null; entity_signer_title?: string | null; entity_authority_confirmed_at?: string | null }) | null,
  signer: (StoredSigner & { permission_confirmed_at?: string | null }) | null,
): OwnershipFormInitial {
  // Tres firmantes por las preguntas (dos en el título + cónyuge que no es el otro titular):
  // se guardó como revisión manual, pero el formulario vuelve a mostrar las preguntas.
  const fromQuestions = o?.owner_kind === "manual_review" && o.other_title_holders && o.married_homestead;
  const kind: OwnerKind | "" = !o ? "" : fromQuestions ? "individuals" : (o.owner_kind as OwnerKind);
  const yn = (b: boolean | undefined): YesNo => (kind !== "individuals" ? "" : b ? "yes" : "no");
  const both = kind === "individuals" && !!o?.other_title_holders && !!o?.married_homestead;
  return {
    kind,
    otherOnTitle: yn(o?.other_title_holders),
    homestead: yn(o?.married_homestead),
    coOwnerIsSpouse: !both ? "" : fromQuestions ? "no" : signer ? "yes" : "",
    signerName: signer?.full_name ?? "",
    signerEmail: signer?.email ?? "",
    signerPermission: !!signer?.permission_confirmed_at,
    entityName: o?.entity_name ?? "",
    entitySignerTitle: o?.entity_signer_title ?? "",
    entityAuthority: !!o?.entity_authority_confirmed_at,
    manualReason: kind === "manual_review" ? ((o?.manual_review_reason ?? "") as ManualReviewReason | "") : "",
  };
}

// Admin del titular y los firmantes (#220). Puro: lo usan la revisión del listing
// (/admin/listings/[id]/review), la cola de aprobación (/admin) y el paso 3.
//
// Reglas (owner, 2026-10-21):
//   - LLC o corporación de Florida: la broker busca al firmante en sunbiz.org (manual en la v1) y
//     marca "figura" (listed) o "no figura" (not_listed). Si no figura, pide una resolución o un
//     poder y el listing no se aprueba hasta marcarlo como recibido.
//   - Revisión manual (entidad de otro estado, trust, sucesión, 3+ dueños, poder): sin acuerdo
//     automático hasta que la broker la destrabe (manual_review_cleared_at).
//   - La broker no aprueba ni contrafirma si falta la firma de algún vendedor.

/** El titular tal como lo lee el staff (listing_ownership). */
export interface StaffOwnership {
  owner_kind: string;
  other_title_holders: boolean;
  married_homestead: boolean;
  entity_name: string | null;
  entity_signer_title: string | null;
  entity_authority_confirmed_at: string | null;
  manual_review_reason: string | null;
  sunbiz_status: string;
  sunbiz_checked_at: string | null;
  authority_document_received_at: string | null;
  manual_review_cleared_at: string | null;
}

export type OwnershipGate =
  | { ok: true }
  | { ok: false; reason: "sunbiz_unchecked" | "entity_authority_pending" | "manual_review_pending" };

/**
 * ¿El titular deja aprobar el listing? Sin fila (listings de antes de #220): sí, como hasta ahora.
 * Entidad: Sunbiz marcado "figura", o la resolución / el poder recibidos.
 */
export function ownershipApprovalGate(o: StaffOwnership | null): OwnershipGate {
  if (!o) return { ok: true };
  if (o.owner_kind === "manual_review" && !o.manual_review_cleared_at) return { ok: false, reason: "manual_review_pending" };
  if (o.owner_kind === "fl_entity") {
    if (o.authority_document_received_at) return { ok: true };
    if (o.sunbiz_status === "listed") return { ok: true };
    if (o.sunbiz_status === "not_listed") return { ok: false, reason: "entity_authority_pending" };
    return { ok: false, reason: "sunbiz_unchecked" };
  }
  return { ok: true };
}

/**
 * ¿Se puede destrabar la revisión manual desde el sitio? Destrabada, el vendedor firma solo (un
 * firmante, signerPlan). Con 3 o más dueños el sobre del sitio no lleva a los demás (el
 * autoservicio admite hasta 2 vendedores): ese acuerdo lo prepara la broker fuera del sitio.
 */
export function canClearManualReview(reason: string | null): boolean {
  return !!reason && reason !== "three_or_more_owners";
}

/** Búsqueda por nombre de entidad en sunbiz.org, con el nombre ya cargado. */
export function sunbizSearchUrl(entityName: string): string {
  const q = new URLSearchParams({ inquiryType: "EntityName", searchTerm: entityName.trim() });
  return `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?${q.toString()}`;
}

export type SignerStatus = "signed" | "pending" | "not_sent";

export interface SignerLine {
  role: "seller" | "second_seller" | "broker";
  name: string;
  /** Relación con la propiedad: titular, cónyuge (homestead) o firmante de la entidad. */
  relationship: "title_holder" | "homestead_spouse" | "entity_signer" | "owner" | "broker";
  status: SignerStatus;
}

interface LiveSigner {
  roleName?: string;
  clientUserId?: string;
  name?: string;
  status?: string;
}

const done = (st: string | undefined) => st === "completed" || st === "signed";

/**
 * Los firmantes del acuerdo para el admin: el vendedor, el segundo (si hay) y la broker, con el
 * estado de cada firma. `live` son los firmantes del sobre en DocuSign; sin ellos (no se pudo
 * leer), el estado guardado.
 */
export function agreementSignerLines(input: {
  ownership: Pick<StaffOwnership, "owner_kind"> | null;
  sellerName: string | null;
  cosigner: { full_name: string; relationship: string } | null;
  agreement: { status: string; sellers_required: number | null; additional_signer_signed_at: string | null } | null;
  live: LiveSigner[] | null;
  propertyId: string;
}): SignerLine[] {
  const { agreement, live } = input;
  const role = (r: LiveSigner) => r.roleName?.trim().toLowerCase() ?? "";
  const liveSeller = live?.find((r) => r.clientUserId === input.propertyId) ?? live?.find((r) => role(r) === "seller");
  const liveSecond = live?.find((r) => role(r) === "seller 2");
  const liveBroker = live?.find((r) => !r.clientUserId && role(r) !== "seller" && role(r) !== "seller 2");
  const stored = agreement?.status ?? null;
  const allSellersSigned = stored === "signed" || stored === "completed";
  const statusOf = (liveSigner: LiveSigner | undefined, storedDone: boolean): SignerStatus =>
    !agreement ? "not_sent" : liveSigner ? (done(liveSigner.status?.toLowerCase()) ? "signed" : "pending") : storedDone ? "signed" : "pending";

  const lines: SignerLine[] = [
    {
      role: "seller",
      name: input.sellerName ?? "",
      relationship: input.ownership?.owner_kind === "fl_entity" ? "entity_signer" : "owner",
      status: statusOf(liveSeller, allSellersSigned),
    },
  ];
  const second = input.cosigner ?? (liveSecond ? { full_name: liveSecond.name ?? "", relationship: "title_holder" } : null);
  if (second || (agreement?.sellers_required ?? 1) === 2) {
    lines.push({
      role: "second_seller",
      name: second?.full_name ?? liveSecond?.name ?? "",
      relationship: second?.relationship === "homestead_spouse" ? "homestead_spouse" : "title_holder",
      status: statusOf(liveSecond, allSellersSigned || !!agreement?.additional_signer_signed_at),
    });
  }
  if (agreement) {
    lines.push({ role: "broker", name: liveBroker?.name ?? "", relationship: "broker", status: statusOf(liveBroker, stored === "completed") });
  }
  return lines;
}

/** ¿Falta la firma de algún vendedor? (la contrafirma y la aprobación esperan). */
export function sellerSignatureMissing(lines: SignerLine[]): boolean {
  return lines.some((l) => l.role !== "broker" && l.status !== "signed");
}

/**
 * Columnas de staff que dejan de valer cuando el vendedor cambia el titular en el paso 3: las
 * marcas de Sunbiz y del documento son de ESA entidad; destrabar la revisión manual, de ESE
 * motivo. Las borra el servidor (el vendedor no puede escribirlas). null = nada que borrar.
 */
export function staffMarksToReset(
  stored: Pick<
    StaffOwnership,
    "owner_kind" | "entity_name" | "manual_review_reason" | "sunbiz_status" | "authority_document_received_at" | "manual_review_cleared_at"
  > | null,
  next: { owner_kind: string; entity_name: string | null; manual_review_reason: string | null },
): Record<string, null | "unchecked"> | null {
  if (!stored) return null;
  const reset: Record<string, null | "unchecked"> = {};
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const entityChanged = next.owner_kind !== "fl_entity" || norm(next.entity_name) !== norm(stored.entity_name);
  if (entityChanged && (stored.sunbiz_status !== "unchecked" || stored.authority_document_received_at)) {
    Object.assign(reset, {
      sunbiz_status: "unchecked",
      sunbiz_checked_by: null,
      sunbiz_checked_at: null,
      authority_document_received_at: null,
      authority_document_received_by: null,
    });
  }
  const reasonChanged = next.owner_kind !== "manual_review" || next.manual_review_reason !== stored.manual_review_reason;
  if (reasonChanged && stored.manual_review_cleared_at) {
    Object.assign(reset, { manual_review_cleared_at: null, manual_review_cleared_by: null });
  }
  return Object.keys(reset).length ? reset : null;
}

type L = "en" | "es";

/** Textos del admin (EN/ES). */
export const SIGNERS_ADMIN_COPY = {
  en: {
    title: "Owner & signers",
    kindLabel: "Owner",
    kind: { individuals: "Individual owner(s)", fl_entity: "Florida LLC or corporation", manual_review: "Manual review" },
    noOwnership: "The seller hasn't answered who owns the property (listings created before this step).",
    otherOnTitle: "Someone else on the title",
    marriedHomestead: "Homestead of a married owner",
    yes: "Yes",
    no: "No",
    entity: "Entity",
    signerTitle: "Signer's title",
    authorityConfirmed: "Seller confirmed authority to sign",
    reason: "Reason",
    reasons: {
      non_fl_entity: "Entity not registered in Florida",
      trust: "Trust",
      estate: "Estate",
      three_or_more_owners: "3 or more owners",
      poa: "Signing with a power of attorney",
    } as Record<string, string>,
    signers: "Signers",
    roles: { seller: "Seller", second_seller: "Seller 2", broker: "Broker" },
    relationships: {
      owner: "Owner",
      title_holder: "On the title",
      homestead_spouse: "Spouse (homestead)",
      entity_signer: "Signs for the entity",
      broker: "Countersignature",
    },
    status: { signed: "Signed", pending: "Pending", not_sent: "Not sent" },
    sunbiz: "Sunbiz",
    sunbizOpen: "Search the entity on sunbiz.org →",
    sunbizHelp: "Check that the signer appears as a manager, authorized member or officer.",
    sunbizStatus: { unchecked: "Not checked", listed: "Signer listed", not_listed: "Signer not listed" },
    markListed: "Signer is listed",
    markNotListed: "Signer is not listed",
    checkedOn: "checked",
    authorityDoc: "Resolution or power of attorney",
    authorityDocHelp: "The signer isn't listed: ask for a resolution or a power of attorney before countersigning.",
    markDocReceived: "Mark as received",
    docReceived: "Received",
    manualReview: "Manual review",
    manualReviewHelp: "No agreement is created automatically. Once you've reviewed the documents and the signers, unlock it so the seller can sign from step 7.",
    clearManualReview: "Unlock: the seller can sign",
    threeOwnersHelp: "3 or more owners: the site's agreement only carries up to 2 sellers, so it can't be unlocked here. Prepare that agreement in DocuSign outside the site.",
    cleared: "Unlocked",
    gate: {
      sunbiz_unchecked: "Check the signer on Sunbiz before approving (and before countersigning in DocuSign).",
      entity_authority_pending: "The signer isn't on Sunbiz: mark the resolution or power of attorney as received before approving. Don't countersign in DocuSign until then.",
      manual_review_pending: "This listing is in manual review: unlock it first.",
    },
    sellerMissing: "A seller's signature is missing. DocuSign sends the agreement to the broker only after every seller signs; approval stays blocked until then.",
    queueManual: "Owner in manual review",
    queueManualEmpty: "None.",
    open: "Open →",
  },
  es: {
    title: "Titular y firmantes",
    kindLabel: "Titular",
    kind: { individuals: "Persona(s) física(s)", fl_entity: "LLC o corporación de Florida", manual_review: "Revisión manual" },
    noOwnership: "El vendedor no contestó quién es el dueño (listings creados antes de este paso).",
    otherOnTitle: "Otra persona en el título",
    marriedHomestead: "Homestead de un propietario casado",
    yes: "Sí",
    no: "No",
    entity: "Entidad",
    signerTitle: "Cargo del firmante",
    authorityConfirmed: "El vendedor confirmó que puede firmar",
    reason: "Motivo",
    reasons: {
      non_fl_entity: "Entidad no registrada en Florida",
      trust: "Trust",
      estate: "Sucesión",
      three_or_more_owners: "3 o más dueños",
      poa: "Firma con poder notarial",
    } as Record<string, string>,
    signers: "Firmantes",
    roles: { seller: "Vendedor", second_seller: "Vendedor 2", broker: "Broker" },
    relationships: {
      owner: "Dueño",
      title_holder: "En el título",
      homestead_spouse: "Cónyuge (homestead)",
      entity_signer: "Firma por la entidad",
      broker: "Contrafirma",
    },
    status: { signed: "Firmó", pending: "Pendiente", not_sent: "Sin enviar" },
    sunbiz: "Sunbiz",
    sunbizOpen: "Buscar la entidad en sunbiz.org →",
    sunbizHelp: "Comprueba que el firmante figure como manager, miembro autorizado u officer.",
    sunbizStatus: { unchecked: "Sin revisar", listed: "Figura", not_listed: "No figura" },
    markListed: "Figura",
    markNotListed: "No figura",
    checkedOn: "revisado",
    authorityDoc: "Resolución o poder",
    authorityDocHelp: "El firmante no figura: pide una resolución o un poder antes de contrafirmar.",
    markDocReceived: "Marcar como recibido",
    docReceived: "Recibido",
    manualReview: "Revisión manual",
    manualReviewHelp: "No se crea ningún acuerdo automático. Cuando revises los documentos y los firmantes, destrábalo para que el vendedor firme desde el paso 7.",
    clearManualReview: "Destrabar: el vendedor puede firmar",
    threeOwnersHelp: "3 o más dueños: el acuerdo del sitio lleva hasta 2 vendedores, así que no se destraba aquí. Prepara ese acuerdo en DocuSign fuera del sitio.",
    cleared: "Destrabado",
    gate: {
      sunbiz_unchecked: "Revisa al firmante en Sunbiz antes de aprobar (y antes de contrafirmar en DocuSign).",
      entity_authority_pending: "El firmante no figura en Sunbiz: marca la resolución o el poder como recibidos antes de aprobar. No contrafirmes en DocuSign hasta entonces.",
      manual_review_pending: "Este listing está en revisión manual: destrábalo primero.",
    },
    sellerMissing: "Falta la firma de un vendedor. DocuSign le manda el acuerdo a la broker solo cuando firmaron todos; la aprobación queda bloqueada hasta entonces.",
    queueManual: "Titular en revisión manual",
    queueManualEmpty: "Ninguno.",
    open: "Abrir →",
  },
} as const;

export function signersAdminCopy(lang: string) {
  return SIGNERS_ADMIN_COPY[(lang === "es" ? "es" : "en") as L];
}

/** Mensajes de error de la aprobación por el titular (?error=…), para las dos páginas. */
export function ownershipGateMessage(reason: string, lang: string): string | null {
  const g = signersAdminCopy(lang).gate as Record<string, string>;
  return g[reason] ?? null;
}

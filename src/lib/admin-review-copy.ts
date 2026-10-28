// Textos de la revisión del listing en el admin (/admin/listings/[id]/review) y de la tarjeta de
// la cola de aprobación, en EN/ES: la página venía solo en inglés aunque se abriera en /es.
// También los valores de la base en palabras ("condo" → "Condominio") y el estado del acuerdo
// para la broker. Puro.

import type { SignerLine } from "@/lib/listing-signers-admin";

type L = "en" | "es";
const pick = (lang: string): L => (lang === "es" ? "es" : "en");

export const ADMIN_REVIEW_COPY = {
  en: {
    back: "← Listings",
    done: "Done: {what}.",
    nothingChanged: "Nothing was changed.",
    doneLabels: {
      listing_approved: "approved",
      listing_rejected: "rejected (withdrawn)",
      listing_changes_requested: "sent back to the seller",
      mls_number_saved: "MLS number saved",
      mls_published_marked: "marked as published on the MLS",
      mls_published_corrected: "publication date corrected",
      seller_request_approved: "request approved and applied",
      seller_request_rejected: "request rejected",
      ownership_sunbiz: "Sunbiz mark saved",
      ownership_authority_document: "document marked as received",
      ownership_clear_manual_review: "manual review unlocked",
    } as Record<string, string>,
    sellerRequests: "Seller requests ({n})",
    sellerRequestsHelp: "Make the change in Matrix first. Approving applies it on lixtara.com; nothing is published before that.",
    requestChange: "Change",
    requestWithdrawal: "Withdrawal",
    withdrawalBody: "Take this listing off the market (→ withdrawn).",
    matrixDoneChange: "Already updated in Matrix",
    matrixDoneWithdrawal: "Already withdrawn in Matrix",
    noteToSeller: "Note to the seller (optional)",
    approveApply: "Approve & apply",
    reject: "Reject",
    mlsPublication: "MLS publication",
    publishedOn: "Published on the MLS:",
    feeEarned: "The flat fee is earned: if the seller cancels now, it is not refunded (except a double charge or a technical error).",
    notPublished: "Not marked as published.",
    fullRefund: "If the seller cancels now, the flat fee is refunded in full.",
    publishHelp: "Do it once the listing is live in Matrix. The date is now; it can't be edited afterwards (only an admin can correct it, with a note).",
    correctDate: "Correct the date (admin) →",
    publishedOnMiami: "Published on (Miami time)",
    clearDate: "Clear the date (the listing was never published)",
    correctionNote: "Why is the date being corrected? (required)",
    saveCorrection: "Save correction",
    history: "History",
    cleared: "cleared",
    mlsNumber: "MLS number",
    current: "Current:",
    notRecorded: "Not recorded yet.",
    correctIt: "Correct it",
    recordIt: "Record it",
    saveMlsNumber: "Save MLS number",
    mlsNumberHelp: "Enter it after the listing is live in Matrix. Saving it closes the “Enter MLS number” task.",
    matrixSheet: "Matrix input sheet →",
    fields: {
      type: "Type",
      bedsBaths: "Beds / Baths",
      sqft: "Sq ft",
      yearBuilt: "Year built",
      listPrice: "List price",
      tier: "Plan",
      buyerComp: "Buyer's agent compensation",
      lotSize: "Lot size",
      description: "Description",
      showings: "Showing instructions",
      legal: "Legal description",
      occupancy: "Occupancy",
      monthlyRent: "Monthly rent",
      leaseEnd: "Lease end",
      tenant: "Tenant",
      tenantNotes: "Tenant notes",
    },
    cassbNeeded: "Needed when a buyer's agent asks for it",
    cassbNotNeeded: "Not needed (0%)",
    photos: "Photos ({n})",
    noPhotos: "No photos uploaded.",
    primary: "Primary",
    agreement: "Listing agreement",
    agreementStatus: "Status:",
    signedOn: "signed {date}",
    noAgreement: "No listing agreement on file yet.",
    mlsNumberOptional: "MLS number (optional)",
    approve: "Approve → Active",
    rejectWithdraw: "Reject (withdraw)",
    requestChanges: "Request changes →",
    requestChangesPlaceholder: "What needs to change before this can be approved?",
    sendBack: "Send back to seller (draft)",
    published: {
      approved: "Listing approved (active)",
      agreement: "Listing agreement completed (sellers signed, broker countersigned)",
      paid: "Plan payment succeeded",
      mlsNumber: "MLS number",
      submit: "Mark as published on the MLS",
    },
    signersCount: "Signers {signed}/{total}",
    agreementLabels: {
      none: "No agreement",
      pending: "Created, not sent",
      sent: "Sent: waiting for the sellers' signatures",
      delivered: "Opened: waiting for the sellers' signatures",
      signed: "Signed by the sellers · waiting for the broker's countersignature",
      completed: "Completed: signed by the sellers and countersigned by the broker",
      declined: "Declined by a signer",
      voided: "Voided",
      expired: "Expired",
    } as Record<string, string>,
    approvalBlock: {
      no_agreement: "There's no listing agreement yet: it can't be approved.",
      agreement_void: "The listing agreement is {status}: the seller has to send a new one before approval.",
      seller_signature_missing: "A seller's signature is missing. Approval stays blocked until every seller signs and the broker countersigns.",
      countersign_missing: "The sellers signed; waiting for the broker's countersignature in DocuSign. Approval stays blocked until then.",
    },
    values: {
      property_type: {
        single_family: "Single family",
        condo: "Condo",
        townhouse: "Townhouse",
        multi_family: "Multi-family",
      } as Record<string, string>,
      occupancy_status: {
        vacant: "Vacant",
        owner_occupied: "Owner-occupied",
        tenant_occupied: "Tenant-occupied",
      } as Record<string, string>,
      tenant_cooperation: {
        cooperative: "Cooperative with showings",
        advance_notice: "Prefers advance notice (24–48 h)",
        difficult: "Difficult",
      } as Record<string, string>,
      mls_status: {
        draft: "Draft",
        pending_approval: "Pending approval",
        active: "Active",
        under_contract: "Under contract",
        closed: "Closed",
        expired: "Expired",
        withdrawn: "Withdrawn",
      } as Record<string, string>,
      tier: { essentials: "Essentials", pro: "Pro", concierge: "Concierge" } as Record<string, string>,
    },
    mlsErrors: {
      invalid_format: "That MLS number doesn't look right (e.g. A11234567).",
      empty: "Enter the MLS number.",
      taken: "That MLS number is already on another listing.",
      failed: "Could not save the MLS number. Try again.",
      matrix_required: "Confirm you already made this change in Matrix.",
      not_pending: "That request was already handled.",
      apply_failed: "Could not apply the request to the listing. Try again.",
      not_countersigned: "The broker hasn't countersigned the listing agreement in DocuSign yet.",
      mark_not_applicable: "That mark doesn't apply to this owner anymore (the seller may have changed it).",
      mark_save_failed: "Could not save the mark. Try again.",
      docusign_unavailable: "Could not confirm the broker's countersignature with DocuSign. Try again.",
      listing_not_active: "Approve the listing (active) before marking it as published on the MLS.",
      already_published: "This listing already has an MLS publication date. Only an admin can correct it.",
      mls_number_required: "Enter the MLS number to mark the listing as published.",
      agreement_not_completed: "The listing agreement isn't completed (signed by the sellers and countersigned) yet.",
      payment_not_succeeded: "The plan payment hasn't succeeded yet.",
      future_date: "The publication date can't be in the future.",
    } as Record<string, string>,
  },
  es: {
    back: "← Listings",
    done: "Listo: {what}.",
    nothingChanged: "No se cambió nada.",
    doneLabels: {
      listing_approved: "aprobado",
      listing_rejected: "rechazado (retirado)",
      listing_changes_requested: "devuelto al vendedor",
      mls_number_saved: "número de MLS guardado",
      mls_published_marked: "marcado como publicado en el MLS",
      mls_published_corrected: "fecha de publicación corregida",
      seller_request_approved: "solicitud aprobada y aplicada",
      seller_request_rejected: "solicitud rechazada",
      ownership_sunbiz: "marca de Sunbiz guardada",
      ownership_authority_document: "documento marcado como recibido",
      ownership_clear_manual_review: "revisión manual destrabada",
    } as Record<string, string>,
    sellerRequests: "Solicitudes del vendedor ({n})",
    sellerRequestsHelp: "Haz el cambio primero en Matrix. Al aprobar se aplica en lixtara.com; antes no se publica nada.",
    requestChange: "Cambio",
    requestWithdrawal: "Retiro",
    withdrawalBody: "Sacar este listing del mercado (→ retirado).",
    matrixDoneChange: "Ya lo actualicé en Matrix",
    matrixDoneWithdrawal: "Ya lo retiré en Matrix",
    noteToSeller: "Nota para el vendedor (opcional)",
    approveApply: "Aprobar y aplicar",
    reject: "Rechazar",
    mlsPublication: "Publicación en el MLS",
    publishedOn: "Publicado en el MLS:",
    feeEarned: "La tarifa fija está devengada: si el vendedor cancela ahora, no se reembolsa (salvo un cobro doble o un error técnico).",
    notPublished: "No está marcado como publicado.",
    fullRefund: "Si el vendedor cancela ahora, la tarifa fija se reembolsa completa.",
    publishHelp: "Hazlo cuando el listing ya esté en Matrix. La fecha es la de ahora; después no se puede editar (solo un admin la corrige, con una nota).",
    correctDate: "Corregir la fecha (admin) →",
    publishedOnMiami: "Publicado el (hora de Miami)",
    clearDate: "Borrar la fecha (el listing nunca se publicó)",
    correctionNote: "¿Por qué se corrige la fecha? (obligatorio)",
    saveCorrection: "Guardar la corrección",
    history: "Historial",
    cleared: "borrada",
    mlsNumber: "Número de MLS",
    current: "Actual:",
    notRecorded: "Todavía no se anotó.",
    correctIt: "Corregirlo",
    recordIt: "Anotarlo",
    saveMlsNumber: "Guardar el número de MLS",
    mlsNumberHelp: "Anótalo cuando el listing ya esté en Matrix. Al guardarlo se cierra la tarea «Anotar el número de MLS».",
    matrixSheet: "Hoja para Matrix →",
    fields: {
      type: "Tipo",
      bedsBaths: "Habitaciones / baños",
      sqft: "Pies²",
      yearBuilt: "Año de construcción",
      listPrice: "Precio de lista",
      tier: "Plan",
      buyerComp: "Compensación al agente del comprador",
      lotSize: "Tamaño del lote",
      description: "Descripción",
      showings: "Instrucciones para visitas",
      legal: "Descripción legal",
      occupancy: "Ocupación",
      monthlyRent: "Renta mensual",
      leaseEnd: "Fin del contrato",
      tenant: "Inquilino",
      tenantNotes: "Notas sobre el inquilino",
    },
    cassbNeeded: "Hace falta cuando lo pide el agente del comprador",
    cassbNotNeeded: "No hace falta (0 %)",
    photos: "Fotos ({n})",
    noPhotos: "No hay fotos.",
    primary: "Principal",
    agreement: "Acuerdo de listado",
    agreementStatus: "Estado:",
    signedOn: "firmado el {date}",
    noAgreement: "Todavía no hay un acuerdo de listado.",
    mlsNumberOptional: "Número de MLS (opcional)",
    approve: "Aprobar → Activo",
    rejectWithdraw: "Rechazar (retirar)",
    requestChanges: "Pedir cambios →",
    requestChangesPlaceholder: "¿Qué hay que cambiar antes de aprobarlo?",
    sendBack: "Devolver al vendedor (borrador)",
    published: {
      approved: "Listing aprobado (activo)",
      agreement: "Acuerdo completo (firmado por los vendedores y contrafirmado por la broker)",
      paid: "Pago del plan confirmado",
      mlsNumber: "Número de MLS",
      submit: "Marcar como publicado en el MLS",
    },
    signersCount: "Firmantes {signed}/{total}",
    agreementLabels: {
      none: "Sin acuerdo",
      pending: "Creado, sin enviar",
      sent: "Enviado: faltan firmas de los vendedores",
      delivered: "Abierto: faltan firmas de los vendedores",
      signed: "Firmado por los vendedores · falta la contrafirma de la broker",
      completed: "Completo: firmado por los vendedores y contrafirmado por la broker",
      declined: "Rechazado por un firmante",
      voided: "Anulado",
      expired: "Vencido",
    } as Record<string, string>,
    approvalBlock: {
      no_agreement: "Todavía no hay acuerdo de listado: no se puede aprobar.",
      agreement_void: "El acuerdo de listado está {status}: el vendedor tiene que enviar uno nuevo antes de aprobar.",
      seller_signature_missing: "Falta la firma de un vendedor. La aprobación queda bloqueada hasta que firmen todos y la broker contrafirme.",
      countersign_missing: "Los vendedores firmaron; falta la contrafirma de la broker en DocuSign. La aprobación queda bloqueada hasta entonces.",
    },
    values: {
      property_type: {
        single_family: "Casa unifamiliar",
        condo: "Condominio",
        townhouse: "Townhouse",
        multi_family: "Multifamiliar",
      } as Record<string, string>,
      occupancy_status: {
        vacant: "Vacía",
        owner_occupied: "Ocupada por el dueño",
        tenant_occupied: "Ocupada por un inquilino",
      } as Record<string, string>,
      tenant_cooperation: {
        cooperative: "Coopera con las visitas",
        advance_notice: "Prefiere aviso previo (24–48 h)",
        difficult: "Difícil",
      } as Record<string, string>,
      mls_status: {
        draft: "Borrador",
        pending_approval: "Pendiente de aprobación",
        active: "Activo",
        under_contract: "Bajo contrato",
        closed: "Cerrado",
        expired: "Vencido",
        withdrawn: "Retirado",
      } as Record<string, string>,
      tier: { essentials: "Essentials", pro: "Pro", concierge: "Concierge" } as Record<string, string>,
    },
    mlsErrors: {
      invalid_format: "Ese número de MLS no parece correcto (p. ej. A11234567).",
      empty: "Escribe el número de MLS.",
      taken: "Ese número de MLS ya está en otro listing.",
      failed: "No se pudo guardar el número de MLS. Inténtalo de nuevo.",
      matrix_required: "Confirma que ya hiciste el cambio en Matrix.",
      not_pending: "Esa solicitud ya se atendió.",
      apply_failed: "No se pudo aplicar la solicitud al listing. Inténtalo de nuevo.",
      not_countersigned: "La broker todavía no contrafirmó el acuerdo de listado en DocuSign.",
      mark_not_applicable: "Esa marca ya no corresponde a este titular (puede que el vendedor lo haya cambiado).",
      mark_save_failed: "No se pudo guardar la marca. Inténtalo de nuevo.",
      docusign_unavailable: "No se pudo confirmar la contrafirma de la broker con DocuSign. Inténtalo de nuevo.",
      listing_not_active: "Aprueba el listing (activo) antes de marcarlo como publicado en el MLS.",
      already_published: "Este listing ya tiene fecha de publicación en el MLS. Solo un admin puede corregirla.",
      mls_number_required: "Escribe el número de MLS para marcar el listing como publicado.",
      agreement_not_completed: "El acuerdo de listado todavía no está completo (firmado por los vendedores y contrafirmado).",
      payment_not_succeeded: "El pago del plan todavía no se confirmó.",
      future_date: "La fecha de publicación no puede ser futura.",
    } as Record<string, string>,
  },
} as const;

export function adminReviewCopy(lang: string) {
  return ADMIN_REVIEW_COPY[pick(lang)];
}

/** Un valor de la base en palabras ("condo" → "Condominio"); sin traducción, el valor legible. */
export function readableValue(
  kind: keyof (typeof ADMIN_REVIEW_COPY)["en"]["values"],
  value: string | null | undefined,
  lang: string,
): string | null {
  if (!value) return null;
  return adminReviewCopy(lang).values[kind][value] ?? value.replace(/_/g, " ");
}

/** El estado del acuerdo para la broker: "signed" = firmaron los vendedores, falta la contrafirma. */
export function agreementStatusLabel(status: string | null | undefined, lang: string): string {
  const labels = adminReviewCopy(lang).agreementLabels;
  return labels[status ?? "none"] ?? status ?? labels.none;
}

export type ApprovalBlock = "no_agreement" | "agreement_void" | "seller_signature_missing" | "countersign_missing";

/**
 * ¿El acuerdo deja aprobar? Solo "completed" (firmaron todos los vendedores y la broker). La
 * acción del servidor lo vuelve a comprobar en vivo con DocuSign (checkBrokerCountersigned).
 */
export function agreementApprovalBlock(status: string | null | undefined, lines: SignerLine[]): ApprovalBlock | null {
  if (!status) return "no_agreement";
  if (status === "completed") return null;
  if (status === "voided" || status === "declined" || status === "expired") return "agreement_void";
  if (status === "signed") return "countersign_missing";
  // pending/sent/delivered: "signed" llega cuando firmaron TODOS los vendedores (#220). Si las
  // líneas en vivo ya muestran a todos firmados, la lectura guardada va atrasada: falta la broker.
  const sellers = lines.filter((l) => l.role !== "broker");
  return sellers.length > 0 && sellers.every((l) => l.status === "signed") ? "countersign_missing" : "seller_signature_missing";
}

export function approvalBlockMessage(block: ApprovalBlock, status: string | null | undefined, lang: string): string {
  const c = adminReviewCopy(lang);
  return c.approvalBlock[block].replace("{status}", agreementStatusLabel(status, lang).toLowerCase());
}

/** "Firmantes 1/2": vendedores que firmaron / vendedores del acuerdo (null con un solo vendedor). */
export function sellersSignedCount(lines: SignerLine[]): { signed: number; total: number } | null {
  const sellers = lines.filter((l) => l.role !== "broker");
  if (sellers.length < 2) return null;
  return { signed: sellers.filter((l) => l.status === "signed").length, total: sellers.length };
}

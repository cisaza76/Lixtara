// Por qué no se puede aprobar un listado desde la tarjeta de /admin: TODOS los motivos a la vez,
// no solo el primero (un listado de prueba con el acuerdo anulado muestra los dos). El orden es
// el de la comprobación del servidor (approval-gate.server.ts): prueba, descripción legal,
// titular, acuerdo. La acción vuelve a comprobarlo todo; esto solo lo dice. Puro.

import { legalPendingMessage } from "@/lib/agreement-legal";
import { ownershipGateMessage } from "@/lib/listing-signers-admin";
import { approvalBlockMessage, type ApprovalBlock } from "@/lib/admin-review-copy";

export function testListingMessage(lang: string): string {
  return lang === "es"
    ? "Listado de prueba: no se puede aprobar ni publicar."
    : "Test listing: it can't be approved or published.";
}

export type ApprovalReasonKind = "test_listing" | "legal_pending" | "owner" | "agreement";

export interface ApprovalReason {
  kind: ApprovalReasonKind;
  /** Código del motivo (p. ej. "sunbiz_unchecked", "agreement_void"); para data-*. */
  code: string;
  message: string;
  /** Se resuelve en la revisión del listado: la tarjeta pone "Abrir →". */
  openReview: boolean;
}

export function approvalReasons(
  input: {
    isTest: boolean;
    legalPending: boolean;
    ownerBlocked: string | null;
    agreementBlocked: ApprovalBlock | null;
    agreementStatus: string | null | undefined;
  },
  lang: string,
): ApprovalReason[] {
  const out: ApprovalReason[] = [];
  if (input.isTest) out.push({ kind: "test_listing", code: "test_listing", message: testListingMessage(lang), openReview: false });
  if (input.legalPending) out.push({ kind: "legal_pending", code: "legal_pending", message: legalPendingMessage(lang), openReview: false });
  if (input.ownerBlocked) {
    out.push({
      kind: "owner",
      code: input.ownerBlocked,
      message: ownershipGateMessage(input.ownerBlocked, lang) ?? input.ownerBlocked,
      openReview: true,
    });
  }
  if (input.agreementBlocked) {
    out.push({
      kind: "agreement",
      code: input.agreementBlocked,
      message: approvalBlockMessage(input.agreementBlocked, input.agreementStatus, lang),
      openReview: true,
    });
  }
  return out;
}

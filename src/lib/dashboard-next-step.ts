export type NextStepKind =
  | "complete"
  | "pay"
  | "agreement"
  | "awaiting_broker"
  | "staging"
  | "video"
  | "offers"
  | "optimized";

export interface NextStepInput {
  mlsStatus: string;
  paymentDone: boolean;
  agreementDone: boolean;
  stagedCount: number;
  videoStatus: string;
  offersCount: number;
}

/**
 * Siguiente paso recomendado de un listing del panel del vendedor: la primera acción pendiente
 * de mayor impacto. Pagado y firmado pero todavía en revisión de la broker, lo primero es
 * explicar qué sigue (auditoría #09); el staging queda como acción secundaria.
 */
export function nextStepKind(i: NextStepInput): NextStepKind {
  if (i.mlsStatus === "draft") return "complete";
  if (!i.paymentDone) return "pay";
  if (!i.agreementDone) return "agreement";
  if (i.mlsStatus === "pending_approval") return "awaiting_broker";
  if (i.stagedCount === 0) return "staging";
  if (i.videoStatus === "none" || i.videoStatus === "failed") return "video";
  if (i.offersCount > 0) return "offers";
  return "optimized";
}

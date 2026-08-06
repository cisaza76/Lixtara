// UX 5C (approved 2026-07-28) — the failed-state view model: a PURE derivation of the
// approved CTA matrix from the status DTO's `failure` object, so the React panel only
// renders and every branch is unit-testable. Never a dead CTA: retry appears only when
// it is both useful (kind) and possible (capacity).
import type { SellerFailureDto } from "@/lib/creative-studio/seller-video-status";

export type FailedDetailKey =
  | "errorDetail"
  | "sourceErrorDetail"
  | "supportErrorDetail"
  | "sourceErrorContainer"
  | "sourceErrorCodec"
  | "sourceErrorHdr"
  | "sourceErrorCorrupt";

export interface FailedViewModel {
  headingKey: "errorHeading" | "sourceErrorHeading";
  showReassurance: boolean;
  detailKey: FailedDetailKey;
  primary: "retry" | "replace" | "support";
  secondary: "support" | "retry" | null;
  showReference: boolean;
  reference: string | null;
}

export function deriveFailedViewModel(failure?: SellerFailureDto | null): FailedViewModel {
  // Legacy/degraded response (no failure object): preserve the pre-5C behavior.
  if (!failure) {
    return {
      headingKey: "errorHeading",
      showReassurance: true,
      detailKey: "errorDetail",
      primary: "retry",
      secondary: "support",
      showReference: false,
      reference: null,
    };
  }

  const reference = failure.reference ?? null;
  const showReference = reference !== null;

  if (failure.kind === "source_action_required") {
    // Etapa 1 — cuatro causas distinguibles para el vendedor (contenedor, códec, HDR,
    // archivo corrupto); cualquier otra cae al mensaje genérico de source.
    const byIssue: Record<string, FailedDetailKey> = {
      container: "sourceErrorContainer",
      codec: "sourceErrorCodec",
      hdr: "sourceErrorHdr",
      corrupt: "sourceErrorCorrupt",
    };
    return {
      headingKey: "sourceErrorHeading",
      showReassurance: false,
      detailKey: byIssue[failure.sourceIssue ?? ""] ?? "sourceErrorDetail",
      primary: "replace",
      secondary: "support",
      showReference,
      reference,
    };
  }

  if (failure.kind === "technical_retryable" && failure.canRetry) {
    return failure.supportPrimary
      ? {
          headingKey: "errorHeading",
          showReassurance: true,
          detailKey: "errorDetail",
          primary: "support",
          secondary: "retry",
          showReference,
          reference,
        }
      : {
          headingKey: "errorHeading",
          showReassurance: true,
          detailKey: "errorDetail",
          primary: "retry",
          secondary: "support",
          showReference,
          reference,
        };
  }

  // technical_support, or retryable-but-out-of-capacity: support only.
  return {
    headingKey: "errorHeading",
    showReassurance: true,
    detailKey: "supportErrorDetail",
    primary: "support",
    secondary: null,
    showReference,
    reference,
  };
}

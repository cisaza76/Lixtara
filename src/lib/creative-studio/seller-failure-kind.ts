// Approved UX decision (2026-07-28) — the closed seller-facing failure classification.
// Derivation rests on EXPLICIT properties of the error, never on category alone:
//   1. `sellerFacing: true` in the video error catalog (the pre-existing flag, now the
//      single source of truth) → the seller must act on THEIR file/inputs.
//   2. Otherwise, ERROR_CLASS "retriable" → a retry is legitimately worth offering.
//   3. Everything else (deterministic technical failures, legacy/unknown codes) →
//      support; blind retry is not useful and burns generation capacity.
// A PREPARATION failure is NOT source fault by itself (it can be snapshot/sandbox/
// infra) — only codes explicitly marked sellerFacing get the source treatment.
import { classifyError, CREATIVE_JOB_ERROR_CODES, type CreativeJobErrorCode } from "@/lib/creative-jobs/errors";
import { VIDEO_ERROR_CATALOG } from "@/lib/video-engine/video-errors";
import { createHash } from "node:crypto";

export type SellerFailureKind = "source_action_required" | "technical_retryable" | "technical_support";

const KNOWN_CODES = new Set<string>(CREATIVE_JOB_ERROR_CODES);

export function sellerFailureKindFor(code: string | null | undefined): SellerFailureKind {
  if (!code || !KNOWN_CODES.has(code)) return "technical_support";
  const jobCode = code as CreativeJobErrorCode;
  const videoEntry = (VIDEO_ERROR_CATALOG as Record<string, { sellerFacing?: boolean }>)[jobCode];
  if (videoEntry?.sellerFacing) return "source_action_required";
  if (classifyError(jobCode) === "retriable") return "technical_retryable";
  return "technical_support";
}

// Support reference shown ONLY in failure states (and the failure emails): 8 uppercase
// hex chars of sha256(traceId) — deterministic and searchable from operations
// (`substr(encode(sha256(trace_id::bytea),'hex'),1,8)`), but NOT a substring of the
// traceId, so it reconstructs nothing.
export function referenceCodeFromTraceId(traceId: string | null | undefined): string | null {
  if (!traceId) return null;
  return createHash("sha256").update(traceId).digest("hex").slice(0, 8).toUpperCase();
}

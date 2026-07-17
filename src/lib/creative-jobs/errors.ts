// Stable per-stage error codes for Creative Jobs. The single source of truth for what
// can go wrong across the render pipeline (download -> sandbox -> render -> QA ->
// upload -> verify -> Asset creation) and the job supervisor (cancellation, attempts
// exhausted). Retry logic and any UI copy depend on the CODE, never on free-text
// `errorMessage` — that field is for humans/logs only.

export const CREATIVE_JOB_ERROR_CODES = [
  "ASSET_DOWNLOAD_FAILED",
  "SANDBOX_CREATE_FAILED",
  "RENDER_FAILED",
  "RENDER_TIMEOUT",
  "TECHNICAL_QA_FAILED",
  "STORAGE_UPLOAD_FAILED",
  "STORAGE_VERIFY_FAILED",
  "ASSET_CREATE_FAILED",
  "JOB_CANCELLED",
  "JOB_ATTEMPTS_EXHAUSTED",
] as const;

export type CreativeJobErrorCode = (typeof CREATIVE_JOB_ERROR_CODES)[number];

export type ErrorClass = "retriable" | "non_retriable" | "cancelled";

// Classification rationale:
// - retriable: transient infra failures where a retry (new attempt) has a real chance
//   of succeeding without any change in inputs — network/download hiccups, a sandbox
//   that failed to provision, a render that ran out of time, or a storage
//   upload/read-verify that failed transiently.
// - non_retriable: deterministic failures — the same inputs would fail the same way
//   again (a render that actually errored, QA that failed against the produced
//   output, Asset-row creation failing after a successful upload) or a job that has
//   already exhausted its retry budget.
// - cancelled: not a failure at all — the seller/system explicitly stopped the job.
export const ERROR_CLASS: Record<CreativeJobErrorCode, ErrorClass> = {
  ASSET_DOWNLOAD_FAILED: "retriable",
  SANDBOX_CREATE_FAILED: "retriable",
  RENDER_FAILED: "non_retriable",
  RENDER_TIMEOUT: "retriable",
  TECHNICAL_QA_FAILED: "non_retriable",
  STORAGE_UPLOAD_FAILED: "retriable",
  STORAGE_VERIFY_FAILED: "retriable",
  ASSET_CREATE_FAILED: "non_retriable",
  JOB_CANCELLED: "cancelled",
  JOB_ATTEMPTS_EXHAUSTED: "non_retriable",
};

export function classifyError(code: CreativeJobErrorCode): ErrorClass {
  return ERROR_CLASS[code];
}

export function isRetriable(code: CreativeJobErrorCode): boolean {
  return classifyError(code) === "retriable";
}

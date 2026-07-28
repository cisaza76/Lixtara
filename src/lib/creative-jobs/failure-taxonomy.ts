// Issue #112 — the STABLE failure taxonomy. One deterministic catalog mapping every
// persistable CreativeJobErrorCode to a closed category set + the pipeline stage it
// belongs to. This is what makes failure analytics a SQL query instead of message
// archaeology: the classification lands verbatim in the failed transition's
// `metadata.evidence.classification` (see pipeline.ts), so
//   `... where metadata->'evidence'->'classification'->>'category' = 'PREPARATION'`
// answers "how many preparation failures?" with zero free-text inspection.
//
// Rules:
//  - Exhaustive over CreativeJobErrorCode (TS Record enforces it at compile time).
//  - Lookup NEVER throws and NEVER guesses: unknown/legacy strings (e.g. the historical
//    lowercase "timeout" written by recoverAbandoned) classify as INTERNAL.
//  - No message sniffing here or anywhere — codes are assigned by typed `instanceof`
//    checks in pipeline.ts's classifyThrown.
import type { CreativeJobErrorCode } from "@/lib/creative-jobs/errors";

export const FAILURE_CATEGORIES = [
  "INPUT", // the listing lacks required inputs (no usable source video / photos)
  "SOURCE", // fetching the source materials failed (download/transfer)
  "PREPARATION", // ffmpeg normalization failed or produced an off-contract file
  "RENDER", // render runtime (sandbox, fonts) or the Remotion render itself
  "QA", // technical QA rejected the produced output
  "STORAGE", // upload / read-verify / Asset-row persistence
  "COORDINATION", // job supervision: cancellation, attempts exhausted, staleness
  "INTERNAL", // pipeline bug / unknown legacy code — needs engineering attention
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

// The stage vocabulary is the OBSERVABILITY stage (pipeline.ts `Stage`), which since
// #112 includes "preparing" — an attribute, not a job state (creative_jobs.state has a
// DB CHECK constraint; this taxonomy deliberately never touches the state machine).
export type FailureStage = "download" | "preparing" | "rendering" | "qa" | "uploading" | "coordination";

export interface FailureTaxonomyEntry {
  category: FailureCategory;
  stage: FailureStage;
}

export const FAILURE_TAXONOMY: Record<CreativeJobErrorCode, FailureTaxonomyEntry> = {
  VIDEO_SOURCE_MISSING: { category: "INPUT", stage: "download" },
  ASSET_DOWNLOAD_FAILED: { category: "SOURCE", stage: "download" },
  VIDEO_PREPARATION_FAILED: { category: "PREPARATION", stage: "preparing" },
  VIDEO_PREPARED_SOURCE_INVALID: { category: "PREPARATION", stage: "preparing" },
  SANDBOX_CREATE_FAILED: { category: "RENDER", stage: "rendering" },
  FONT_STRATEGY_MISMATCH: { category: "RENDER", stage: "rendering" },
  RENDER_FAILED: { category: "RENDER", stage: "rendering" },
  RENDER_TIMEOUT: { category: "RENDER", stage: "rendering" },
  TECHNICAL_QA_FAILED: { category: "QA", stage: "qa" },
  STORAGE_UPLOAD_FAILED: { category: "STORAGE", stage: "uploading" },
  STORAGE_VERIFY_FAILED: { category: "STORAGE", stage: "uploading" },
  ASSET_CREATE_FAILED: { category: "STORAGE", stage: "uploading" },
  JOB_CANCELLED: { category: "COORDINATION", stage: "coordination" },
  JOB_ATTEMPTS_EXHAUSTED: { category: "COORDINATION", stage: "coordination" },
};

const INTERNAL_ENTRY: FailureTaxonomyEntry = { category: "INTERNAL", stage: "coordination" };

// Total lookup over arbitrary strings (transitions written before this catalog existed
// carry legacy codes). Never throws, never guesses beyond INTERNAL.
export function failureTaxonomyFor(code: string): FailureTaxonomyEntry {
  return (FAILURE_TAXONOMY as Record<string, FailureTaxonomyEntry>)[code] ?? INTERNAL_ENTRY;
}

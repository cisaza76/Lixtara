// F3-A Step 1 — the uploaded-video error catalog (CONTRACT ONLY). Stable, categorized,
// retryable-tagged error codes for the uploaded_video pipeline. This module does NOT
// modify the production Creative Job error catalog (src/lib/creative-jobs/errors.ts) — a
// later, separately-authorized step reconciles these codes into it. Nothing in the
// production render path imports this yet, so it contributes zero behavior change.
//
// Design rules honored (gate §"Errores"):
//  - every code declares a category and whether it is retryable;
//  - failures are distinguished by origin (user input / authorization / preparation /
//    runtime / render / QA / persistence — plus two structural buckets: primary-asset
//    promotion and state-machine);
//  - a runtime-dependency install failure (VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED) is a
//    DISTINCT, retryable code — it must never be collapsed into VIDEO_RENDER_FAILED
//    (gate D1).
//
// This module deliberately does NOT import @/lib/creative-jobs (the video-engine module-
// isolation invariant, produce-asset.test.ts) — the shared pipeline codes it cross-
// references below are named as plain string literals, not imported, so the video-engine
// core stays state-machine-free.

export const VIDEO_ERROR_CATEGORIES = [
  "user_input", // the seller's source is unusable as provided (deterministic, seller-actionable)
  "authorization", // the source is not the caller's / not on this listing
  "preparation", // normalization (validate/ffmpeg) failed or produced an off-contract file
  "runtime", // the render runtime/environment (dependency install, sandbox) failed
  "render", // Remotion render itself failed
  "qa", // technical QA rejected the produced output
  "persistence", // upload / read-verify / Asset-row creation failed
  "primary", // a Primary Marketing Video promotion request was invalid
  "state", // an illegal Creative Job state transition was attempted
] as const;
export type VideoErrorCategory = (typeof VIDEO_ERROR_CATEGORIES)[number];

export const VIDEO_ERROR_CODES = [
  // --- user input (source unusable as provided) ---
  "VIDEO_SOURCE_MISSING",
  "VIDEO_CONTAINER_UNSUPPORTED",
  "VIDEO_CODEC_UNSUPPORTED",
  "VIDEO_STREAM_MISSING",
  "VIDEO_DURATION_EXCEEDED",
  "VIDEO_FILE_TOO_LARGE",
  "VIDEO_RESOLUTION_EXCEEDED",
  "VIDEO_CORRUPT",
  "VIDEO_HDR_UNSUPPORTED",
  // --- authorization ---
  "VIDEO_SOURCE_UNAUTHORIZED",
  // --- preparation ---
  "VIDEO_PREPARATION_FAILED",
  "VIDEO_PREPARED_SOURCE_INVALID",
  // --- runtime ---
  "VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED",
  // --- render ---
  "VIDEO_RENDER_FAILED",
  // --- qa ---
  "VIDEO_QA_FAILED",
  // --- primary-asset promotion ---
  "VIDEO_PRIMARY_ASSET_INVALID",
  // --- state machine ---
  "VIDEO_STATE_TRANSITION_INVALID",
] as const;
export type VideoErrorCode = (typeof VIDEO_ERROR_CODES)[number];

export interface VideoErrorDescriptor {
  code: VideoErrorCode;
  category: VideoErrorCategory;
  // retryable: a NEW attempt with the SAME durable source has a real chance of succeeding
  // without any change in inputs (transient infra). Deterministic failures (the same
  // source would fail identically) are non-retryable.
  retryable: boolean;
  // sellerFacing: the seller can act on it (fix/replace the source). Technical failures
  // are surfaced to admin/support only (mirrors the two-level status split).
  sellerFacing: boolean;
}

export const VIDEO_ERROR_CATALOG: Record<VideoErrorCode, VideoErrorDescriptor> = {
  VIDEO_SOURCE_MISSING: { code: "VIDEO_SOURCE_MISSING", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_CONTAINER_UNSUPPORTED: { code: "VIDEO_CONTAINER_UNSUPPORTED", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_CODEC_UNSUPPORTED: { code: "VIDEO_CODEC_UNSUPPORTED", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_STREAM_MISSING: { code: "VIDEO_STREAM_MISSING", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_DURATION_EXCEEDED: { code: "VIDEO_DURATION_EXCEEDED", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_FILE_TOO_LARGE: { code: "VIDEO_FILE_TOO_LARGE", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_RESOLUTION_EXCEEDED: { code: "VIDEO_RESOLUTION_EXCEEDED", category: "user_input", retryable: false, sellerFacing: true },
  VIDEO_CORRUPT: { code: "VIDEO_CORRUPT", category: "user_input", retryable: false, sellerFacing: true },
  // Etapa 1 (2026-08-05): HDR/Dolby Vision aún no soportado. sellerFacing: el vendedor
  // PUEDE actuar (grabar sin HDR o reemplazar el archivo) — de ahí que la UX lo trate
  // como "problema con tu video" y no como fallo técnico.
  VIDEO_HDR_UNSUPPORTED: { code: "VIDEO_HDR_UNSUPPORTED", category: "user_input", retryable: false, sellerFacing: true },

  VIDEO_SOURCE_UNAUTHORIZED: { code: "VIDEO_SOURCE_UNAUTHORIZED", category: "authorization", retryable: false, sellerFacing: false },

  VIDEO_PREPARATION_FAILED: { code: "VIDEO_PREPARATION_FAILED", category: "preparation", retryable: false, sellerFacing: false },
  VIDEO_PREPARED_SOURCE_INVALID: { code: "VIDEO_PREPARED_SOURCE_INVALID", category: "preparation", retryable: false, sellerFacing: false },

  // Distinct + RETRYABLE (network/registry transient). Never collapse into
  // VIDEO_RENDER_FAILED (gate D1) — a failed dependency install is not a render failure.
  VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED: {
    code: "VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED",
    category: "runtime",
    retryable: true,
    sellerFacing: false,
  },

  VIDEO_RENDER_FAILED: { code: "VIDEO_RENDER_FAILED", category: "render", retryable: false, sellerFacing: false },
  VIDEO_QA_FAILED: { code: "VIDEO_QA_FAILED", category: "qa", retryable: false, sellerFacing: false },
  VIDEO_PRIMARY_ASSET_INVALID: { code: "VIDEO_PRIMARY_ASSET_INVALID", category: "primary", retryable: false, sellerFacing: false },
  VIDEO_STATE_TRANSITION_INVALID: { code: "VIDEO_STATE_TRANSITION_INVALID", category: "state", retryable: false, sellerFacing: false },
};

export function videoErrorCategory(code: VideoErrorCode): VideoErrorCategory {
  return VIDEO_ERROR_CATALOG[code].category;
}

export function isVideoErrorRetryable(code: VideoErrorCode): boolean {
  return VIDEO_ERROR_CATALOG[code].retryable;
}

// Cross-reference: the shared pipeline codes (src/lib/creative-jobs/errors.ts) that cover
// the "persistence" and shared-"runtime" origins for the uploaded_video path too, so the
// full taxonomy stays visible in one place without redefining those codes here. Keys are
// plain string literals mirroring CreativeJobErrorCode names — NOT imported, to preserve
// the video-engine module-isolation invariant (no @/lib/creative-jobs import).
export const SHARED_PIPELINE_ERROR_CATEGORY: Record<string, VideoErrorCategory> = {
  ASSET_DOWNLOAD_FAILED: "preparation",
  SANDBOX_CREATE_FAILED: "runtime",
  FONT_STRATEGY_MISMATCH: "runtime",
  STORAGE_UPLOAD_FAILED: "persistence",
  STORAGE_VERIFY_FAILED: "persistence",
  ASSET_CREATE_FAILED: "persistence",
};

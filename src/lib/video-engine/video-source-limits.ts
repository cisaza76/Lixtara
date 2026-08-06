// F3-A Step 1 — centralized, named MVP limits for an uploaded source video, plus a PURE
// checker that maps a parsed `SourceVideoMetadata` to typed violations. NO magic numbers
// scattered elsewhere: every threshold has a name, an explicit unit, and an unambiguous
// message. NO ffprobe/FFmpeg execution here — `checkSourceLimits` operates on an
// already-parsed metadata object (the actual ffprobe read lands in a later step).
//
// CONTRACT ONLY: not imported by any production render-path module yet → zero behavior
// change.
import type { SourceVideoMetadata } from "@/lib/video-engine/media-metadata";
import type { VideoErrorCode } from "@/lib/video-engine/video-errors";

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Accepted source (input) envelope — gate §10, provisional MVP values.
// ---------------------------------------------------------------------------
export const VIDEO_SOURCE_LIMITS = {
  maxDurationSeconds: 60,
  maxFileBytes: 300 * MB, // 300 MB — see reconciliation note below

  // Orientation-agnostic 4K ceiling. The check sorts the two edges, so BOTH a horizontal
  // 4K (3840×2160) and a vertical 4K (2160×3840) are accepted, while anything whose LONG
  // edge exceeds 3840 px OR whose SHORT edge exceeds 2160 px (e.g. 8K, or an ultra-wide)
  // is rejected. The limit is on the DIMENSIONS, never on the orientation.
  maxLongEdgePx: 3840,
  maxShortEdgePx: 2160,

  // Etapa 1 (2026-08-05): MP4 y MOV/QuickTime. Nota técnica: ffprobe reporta el MISMO
  // `format_name` ("mov,mp4,m4a,3gp,3g2,mj2") para ambos — la lista deja la intención
  // explícita y no depende de ese alias compartido. HEVC sigue fuera (Etapa 2).
  containers: ["mp4", "mov"] as const,
  videoCodec: "h264" as const, // H.264 only
  audioCodecs: ["aac"] as const, // AAC, or no audio at all
  videoStreamRequired: true, // a video stream is mandatory
  audioStreamRequired: false, // audio is optional
} as const;

// ---------------------------------------------------------------------------
// Normalized output envelope — gate §10. What every render_profile targets.
// ---------------------------------------------------------------------------
export const VIDEO_OUTPUT_SPEC = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "h264" as const,
  audioCodec: "aac" as const,
} as const;

// Reconciliation with existing infrastructure (gate §10, "usa el valor más conservador"):
//  - Storage output ceiling MAX_VIDEO_BYTES = 500 MB (storage-adapter.supabase.ts) is the
//    ceiling for the PRODUCED render; the 300 MB here is the stricter INPUT cap and is
//    independent of (and below) that ceiling → no conflict.
//  - Sandbox memory ~8.6 GB / default render timeout ~5 min: the 60 s duration cap is the
//    load-bearing bound that keeps prepare+render+QA inside those (F2-D data). Raising the
//    sandbox/worker timeouts for uploaded_video is a later (provider/worker) step, not a
//    limit value.
export const VIDEO_LIMIT_RECONCILIATION = {
  outputCeilingBytes: 500 * MB,
  inputCapBytes: VIDEO_SOURCE_LIMITS.maxFileBytes,
  note: "input cap (300 MB) is stricter than and independent of the 500 MB output storage ceiling",
} as const;

export interface SourceLimitViolation {
  code: VideoErrorCode;
  message: string;
}

// Sorted (long, short) edges — the basis for the orientation-agnostic resolution check.
export function sortedEdges(width: number, height: number): { longEdge: number; shortEdge: number } {
  return width >= height ? { longEdge: width, shortEdge: height } : { longEdge: height, shortEdge: width };
}

// PURE, positive-signal-only HDR detection (Etapa 1). Nunca lanza; nunca infiere HDR de
// la ausencia de metadata.
const HDR_TRANSFERS = ["smpte2084", "arib-std-b67", "smpte428", "bt2020-10", "bt2020-12"] as const;
const HDR_PRIMARIES_OR_SPACE = ["bt2020", "bt2020nc", "bt2020_ncl", "bt2020c"] as const;

export function isHdrSource(meta: SourceVideoMetadata): boolean {
  if (meta.dolbyVision === true) return true;
  const transfer = (meta.colorTransfer ?? "").toLowerCase();
  if ((HDR_TRANSFERS as readonly string[]).includes(transfer)) return true;
  const primaries = (meta.colorPrimaries ?? "").toLowerCase();
  const space = (meta.colorSpace ?? "").toLowerCase();
  return (
    (HDR_PRIMARIES_OR_SPACE as readonly string[]).includes(primaries) ||
    (HDR_PRIMARIES_OR_SPACE as readonly string[]).includes(space)
  );
}

// PURE: compares parsed metadata to the limits and returns ALL violations (never throws,
// never short-circuits — the caller decides which single code to surface first, but the
// full list is available for logging/provenance). Does NOT cover VIDEO_CORRUPT: corruption
// is only knowable from a real decode pass (a later ffmpeg step), not from metadata.
export function checkSourceLimits(meta: SourceVideoMetadata): SourceLimitViolation[] {
  const v: SourceLimitViolation[] = [];

  // Video stream mandatory.
  const hasVideo = meta.videoCodec !== null && meta.width > 0 && meta.height > 0;
  if (!hasVideo) {
    v.push({
      code: "VIDEO_STREAM_MISSING",
      message: "Source has no usable video stream (a video stream is required).",
    });
    // Without a video stream, container/codec/resolution checks below are meaningless.
    return v;
  }

  // Container.
  const declared = meta.container.split(",");
  const containerOk = VIDEO_SOURCE_LIMITS.containers.some((c) => declared.includes(c));
  if (!containerOk) {
    v.push({
      code: "VIDEO_CONTAINER_UNSUPPORTED",
      message: `Source container "${meta.container}" is not supported (accepted: ${VIDEO_SOURCE_LIMITS.containers.join(", ")}).`,
    });
  }

  // Video codec.
  if (meta.videoCodec !== VIDEO_SOURCE_LIMITS.videoCodec) {
    v.push({
      code: "VIDEO_CODEC_UNSUPPORTED",
      message: `Source video codec "${meta.videoCodec}" is not supported (only ${VIDEO_SOURCE_LIMITS.videoCodec} is accepted).`,
    });
  }

  // HDR (Etapa 1: rechazo fail-closed; el tone-mapping real llega en Etapa 2). Solo una
  // señal POSITIVA cuenta: transferencia PQ/HLG, primarios o matriz BT.2020, o un record
  // Dolby Vision en side_data. Un source sin estas etiquetas se trata como SDR — lo
  // contrario tumbaría archivos legítimos que simplemente no las declaran.
  if (isHdrSource(meta)) {
    v.push({
      code: "VIDEO_HDR_UNSUPPORTED",
      message: `Source is HDR (transfer "${meta.colorTransfer ?? "?"}", primaries "${meta.colorPrimaries ?? "?"}"${meta.dolbyVision ? ", Dolby Vision" : ""}); HDR is not supported yet.`,
    });
  }

  // Audio codec (optional, but if present must be accepted).
  if (meta.audioCodec !== null && !(VIDEO_SOURCE_LIMITS.audioCodecs as readonly string[]).includes(meta.audioCodec)) {
    v.push({
      code: "VIDEO_CODEC_UNSUPPORTED",
      message: `Source audio codec "${meta.audioCodec}" is not supported (accepted: ${VIDEO_SOURCE_LIMITS.audioCodecs.join(", ")}, or no audio).`,
    });
  }

  // Duration.
  if (meta.durationSeconds > VIDEO_SOURCE_LIMITS.maxDurationSeconds) {
    v.push({
      code: "VIDEO_DURATION_EXCEEDED",
      message: `Source duration ${meta.durationSeconds}s exceeds the maximum of ${VIDEO_SOURCE_LIMITS.maxDurationSeconds}s.`,
    });
  }

  // File size.
  if (meta.bytes > VIDEO_SOURCE_LIMITS.maxFileBytes) {
    v.push({
      code: "VIDEO_FILE_TOO_LARGE",
      message: `Source file ${meta.bytes} bytes exceeds the maximum of ${VIDEO_SOURCE_LIMITS.maxFileBytes} bytes (${VIDEO_SOURCE_LIMITS.maxFileBytes / MB} MB).`,
    });
  }

  // Resolution — orientation-agnostic.
  const { longEdge, shortEdge } = sortedEdges(meta.width, meta.height);
  if (longEdge > VIDEO_SOURCE_LIMITS.maxLongEdgePx || shortEdge > VIDEO_SOURCE_LIMITS.maxShortEdgePx) {
    v.push({
      code: "VIDEO_RESOLUTION_EXCEEDED",
      message:
        `Source resolution ${meta.width}×${meta.height} (long ${longEdge}px, short ${shortEdge}px) exceeds the ` +
        `maximum of ${VIDEO_SOURCE_LIMITS.maxLongEdgePx}×${VIDEO_SOURCE_LIMITS.maxShortEdgePx} px, applied ` +
        `orientation-agnostically (vertical 4K is accepted; 8K is not).`,
    });
  }

  return v;
}

// Convenience: the single most relevant violation to surface (first in declared priority
// order), or null when the source is within limits. Full list stays available via
// checkSourceLimits for logging/provenance.
export function firstSourceLimitViolation(meta: SourceVideoMetadata): SourceLimitViolation | null {
  return checkSourceLimits(meta)[0] ?? null;
}

// F3-A Step 2 — the PURE, deterministic video-preparation layer. Turns
// (SourceVideoMetadata + RenderProfileSpec + limits) into a serializable PreparationPlan
// (opaque FFmpeg args + a stable fingerprint), and validates a prepared file's probed
// metadata. NO process execution, NO I/O, NO FFmpeg spawn, NO sandbox, NO Remotion — this
// module only BUILDS the recipe. All FFmpeg specifics live behind this layer (Contract
// Freeze §8.3); nothing above it sees an FFmpeg detail.
//
// INVARIANT (server-only): this module depends on `node:crypto`, so it is a server-side
// module ONLY. It must never be imported from a client component or a browser bundle.
//
// Boundary: imports only pure video-engine modules (+ node:crypto for the fingerprint).
// It does NOT modify any frozen contract. Two contracts it needs but that the freeze did
// not expose are defined here ADDITIVELY (no frozen file touched):
//   - `VideoSourceLimits` = typeof the frozen VIDEO_SOURCE_LIMITS const (the freeze
//     exported the value, not a named type);
//   - `PreparedVideoProbe` extends the frozen SourceVideoMetadata with `pixelFormat`
//     (SourceVideoMetadata has no pixelFormat; validating yuv420p needs it).
// Both are additive supersets — no frozen type/discriminant/invariant is changed.
import { createHash } from "node:crypto";
import type { SourceVideoMetadata } from "@/lib/video-engine/media-metadata";
import type { RenderProfileSpec } from "@/lib/video-engine/render-profiles";
import { VIDEO_SOURCE_LIMITS, checkSourceLimits } from "@/lib/video-engine/video-source-limits";
import type { VideoErrorCode } from "@/lib/video-engine/video-errors";

// Additive type alias over the frozen const (freeze exported the value only).
export type VideoSourceLimits = typeof VIDEO_SOURCE_LIMITS;

// Additive superset of the frozen SourceVideoMetadata: the prepared file's probe also
// carries the pixel format (needed to assert yuv420p) and the color range (needed to
// assert limited/TV range — a full-range H.264 stream probes as yuvj420p/pc). Frozen
// type unchanged.
export interface PreparedVideoProbe extends SourceVideoMetadata {
  pixelFormat: string | null;
  // ffprobe `color_range`: "tv" | "pc" | null when the stream carries no VUI range
  // signal. H.264 semantics: an unspecified range IS limited range, so null is accepted.
  colorRange: string | null;
}

// ---------------------------------------------------------------------------
// Centralized, named parameters (Contract Freeze §"no magic numbers"). Quality-first,
// NOT speed-first, and justified: the prepared file is an INTERMEDIATE that Remotion
// re-encodes downstream, so we preserve quality (low CRF, balanced preset) to avoid
// visible double-compression loss — deliberately not `veryfast`. A speed pass, if ever
// needed, is a documented change here, not scattered flags.
// ---------------------------------------------------------------------------
export const PREPARATION_PLAN_SCHEMA_VERSION = "2";

export const ENCODE_PARAMS = {
  videoCodec: "libx264",
  preset: "medium",
  crf: "18",
  pixelFormat: "yuv420p",
  audioCodec: "aac",
  audioBitrate: "192k",
} as const;

export const BLUR_SIGMA = 30; // F2-D Strategy C blurred-fill background sigma

// Shared tail of BOTH filter graphs: real color-range normalization (a dedicated swscale
// pass — value conversion, not metadata retagging), then pixel format, then SAR. Gate 5A
// (job 9467cc1f, 2026-07-27) proved a full-range source (yuvj420p/pc, e.g. JPEG-derived or
// a phone recording in full range) survives `format=yuv420p` alone: swscale treats j420p
// as the same layout, the encoder re-signals full range in the VUI, and the prepared file
// probes as yuvj420p — failing the strict validator. `in_range=auto` reads the stream's
// own range tag (untagged input is limited per H.264 defaults → no-op), `out_range=tv`
// remaps values to limited range where needed. Version-robust: explicit filter semantics,
// never ffmpeg's implicit range negotiation.
const RANGE_NORMALIZATION_TAIL = `scale=in_range=auto:out_range=tv,format=${ENCODE_PARAMS.pixelFormat},setsar=1`;

// Operational placeholders — kept OUT of the fingerprint. `buildNormalizeFfmpegArgs`
// returns a ref-FREE recipe (these placeholders in the -i / output positions);
// `planVideoPreparation` splices in the real, temporary refs. This is the freeze's
// "operational refs vs. semantic content" split (§"Prepared source"): equivalent plans
// with different temp refs share a fingerprint.
export const SOURCE_PLACEHOLDER = "${SOURCE}";
export const OUTPUT_PLACEHOLDER = "${OUTPUT}";

// A source counts as "effectively 16:9" when its rotation-corrected aspect ratio is within
// this absolute tolerance of the profile's target AR (covers 1920×1088-style encoder
// padding without forcing a blurred-fill).
const AR_TOLERANCE_16_9 = 0.02;
// Below this |Δfps| the input is treated as already at the target rate (no fps
// transformation is RECORDED — the fps filter is still emitted for determinism).
const FPS_EQUAL_TOLERANCE = 0.05;
// Prepared-output fps must land within this of the profile fps.
const PREPARED_FPS_TOLERANCE = 0.05;

// ---------------------------------------------------------------------------
// Transformations — the machine-readable record of what the recipe does.
// ---------------------------------------------------------------------------
export type VideoTransformation =
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "strip_rotation_metadata" }
  | { kind: "scale_fit"; targetWidth: number; targetHeight: number }
  | { kind: "pad_canvas"; targetWidth: number; targetHeight: number }
  | { kind: "blurred_fill"; sourceAspect: string; sigma: number; targetWidth: number; targetHeight: number }
  | { kind: "fps"; from: number; to: number }
  | { kind: "pixel_format"; to: "yuv420p" }
  | { kind: "color_range"; to: "tv" }
  | { kind: "audio_transcode"; to: "aac" }
  | { kind: "drop_audio" };

export interface PreparationPlan {
  sourceRef: string;
  normalizedRef: string;
  ffmpegArgs: readonly string[];
  transformations: readonly VideoTransformation[];
  expectedOutput: {
    width: number;
    height: number;
    fps: number;
    colorRange: "tv";
    videoCodec: "h264";
    audioCodec: "aac" | null;
    pixelFormat: "yuv420p";
  };
  preparationFingerprint: string;
}

export interface PreparedMetadataValidationResult {
  ok: boolean;
  // Every failure maps to this single stable code (never a generic Error).
  code: "VIDEO_PREPARED_SOURCE_INVALID" | null;
  violations: { check: string; message: string }[];
}

export class VideoPreparationError extends Error {
  constructor(
    readonly code: VideoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VideoPreparationError";
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers.
// ---------------------------------------------------------------------------

// Rotation-corrected dimensions: 90°/270° swap width and height (gate §2).
export function effectiveDimensions(m: SourceVideoMetadata): { width: number; height: number } {
  const swap = m.rotationDegrees === 90 || m.rotationDegrees === 270;
  return swap ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}

export function isEffectively169(m: SourceVideoMetadata, profile: RenderProfileSpec): boolean {
  const { width, height } = effectiveDimensions(m);
  if (height <= 0) return false;
  const targetAr = profile.width / profile.height;
  return Math.abs(width / height - targetAr) < AR_TOLERANCE_16_9;
}

// Physically bake the display rotation into the pixels (so the output needs no rotate
// metadata). transpose=1 = 90° clockwise; transpose=2 = 90° counter-clockwise. The exact
// CW/CCW convention is validated against real ffmpeg in a later execution gate; this pure
// layer fixes a single documented convention and tests its STRUCTURE.
function rotationFilters(degrees: number): string[] {
  switch (degrees) {
    case 90:
      return ["transpose=1"];
    case 180:
      return ["transpose=1", "transpose=1"];
    case 270:
      return ["transpose=2"];
    default:
      return [];
  }
}

function build169Graph(rot: string[], profile: RenderProfileSpec): string {
  const pre = rot.length ? rot.join(",") + "," : "";
  // decrease-fit within the frame (even dims), then pad to the exact even canvas so any
  // rounding gap is filled deterministically, then normalize fps + pixel format + SAR.
  return (
    `[0:v]${pre}scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,fps=${profile.fps},${RANGE_NORMALIZATION_TAIL}[v]`
  );
}

function buildBlurredFillGraph(rot: string[], profile: RenderProfileSpec): string {
  const pre = rot.length ? rot.join(",") + "," : "";
  // F2-D Strategy C: blurred cover background (crop-fill + gblur) + contained foreground,
  // centered — a single normalized 16:9 output. No layout is left for Remotion.
  return [
    `[0:v]${pre}split=2[bg][fg]`,
    `[bg]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase,` +
      `crop=${profile.width}:${profile.height},gblur=sigma=${BLUR_SIGMA}[bgb]`,
    `[fg]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${profile.fps},${RANGE_NORMALIZATION_TAIL}[v]`,
  ].join(";");
}

// ---------------------------------------------------------------------------
// buildNormalizeFfmpegArgs — the ref-FREE FFmpeg recipe (opaque to callers).
// ---------------------------------------------------------------------------
export function buildNormalizeFfmpegArgs(
  metadata: SourceVideoMetadata,
  profile: RenderProfileSpec,
): readonly string[] {
  const rot = rotationFilters(metadata.rotationDegrees);
  const graph = isEffectively169(metadata, profile)
    ? build169Graph(rot, profile)
    : buildBlurredFillGraph(rot, profile);
  const hasAudio = metadata.audioCodec !== null;

  return [
    "-hide_banner",
    "-y",
    "-noautorotate", // input option: we bake rotation ourselves; ffmpeg must not auto-apply it
    "-i",
    SOURCE_PLACEHOLDER,
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    // Audio: map ONLY the first audio stream (deterministic for multi-audio sources), or
    // disable audio entirely. Never fabricate a silent track.
    ...(hasAudio ? ["-map", "0:a:0"] : ["-an"]),
    "-c:v",
    ENCODE_PARAMS.videoCodec,
    "-preset",
    ENCODE_PARAMS.preset,
    "-crf",
    ENCODE_PARAMS.crf,
    "-pix_fmt",
    ENCODE_PARAMS.pixelFormat,
    // Coherent range METADATA on the encoded stream. The VALUE conversion is the graph's
    // RANGE_NORMALIZATION_TAIL — this flag alone never suffices (metadata-only retag was
    // measured to leave ill-defined pixel values; see the Gate 5A remediation evidence).
    "-color_range",
    "tv",
    ...(hasAudio ? ["-c:a", ENCODE_PARAMS.audioCodec, "-b:a", ENCODE_PARAMS.audioBitrate] : []),
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1", // strip container metadata so input rotation can't leak back onto the output
    "-metadata:s:v:0",
    "rotate=0", // and clear any residual rotate flag on the video stream
    "-f",
    "mp4",
    OUTPUT_PLACEHOLDER,
  ];
}

// ---------------------------------------------------------------------------
// Transformations record.
// ---------------------------------------------------------------------------
export function buildTransformations(
  metadata: SourceVideoMetadata,
  profile: RenderProfileSpec,
): VideoTransformation[] {
  const t: VideoTransformation[] = [];
  if (metadata.rotationDegrees !== 0) {
    t.push({ kind: "rotate", degrees: metadata.rotationDegrees as 90 | 180 | 270 });
    t.push({ kind: "strip_rotation_metadata" });
  }
  const eff = effectiveDimensions(metadata);
  if (isEffectively169(metadata, profile)) {
    t.push({ kind: "scale_fit", targetWidth: profile.width, targetHeight: profile.height });
    t.push({ kind: "pad_canvas", targetWidth: profile.width, targetHeight: profile.height });
  } else {
    t.push({
      kind: "blurred_fill",
      sourceAspect: `${eff.width}:${eff.height}`,
      sigma: BLUR_SIGMA,
      targetWidth: profile.width,
      targetHeight: profile.height,
    });
  }
  const inFps = roundTo(metadata.fps, 3);
  if (Math.abs(inFps - profile.fps) > FPS_EQUAL_TOLERANCE) {
    t.push({ kind: "fps", from: inFps, to: profile.fps });
  }
  t.push({ kind: "pixel_format", to: "yuv420p" });
  t.push({ kind: "color_range", to: "tv" });
  t.push(metadata.audioCodec !== null ? { kind: "audio_transcode", to: "aac" } : { kind: "drop_audio" });
  return t;
}

// Human-readable projection (for PreparedVideoSource.transformations later).
export function describeTransformations(ts: readonly VideoTransformation[]): string[] {
  return ts.map((t) => {
    switch (t.kind) {
      case "rotate":
        return `rotate ${t.degrees}°`;
      case "strip_rotation_metadata":
        return "strip rotation metadata";
      case "scale_fit":
        return `scale to fit ${t.targetWidth}×${t.targetHeight}`;
      case "pad_canvas":
        return `pad canvas to ${t.targetWidth}×${t.targetHeight}`;
      case "blurred_fill":
        return `blurred-fill ${t.sourceAspect} → ${t.targetWidth}×${t.targetHeight} (sigma ${t.sigma})`;
      case "fps":
        return `fps ${t.from} → ${t.to}`;
      case "pixel_format":
        return `pixel format → ${t.to}`;
      case "color_range":
        return `color range → ${t.to} (limited)`;
      case "audio_transcode":
        return `audio → ${t.to}`;
      case "drop_audio":
        return "drop audio (no source audio)";
    }
  });
}

// ---------------------------------------------------------------------------
// planVideoPreparation — validate limits (reusing the frozen checker), build the recipe,
// splice in the operational refs, and stamp a deterministic fingerprint.
// ---------------------------------------------------------------------------
export function planVideoPreparation(
  metadata: SourceVideoMetadata,
  profile: RenderProfileSpec,
  limits: VideoSourceLimits,
  refs: { sourceRef: string; normalizedRef: string },
): PreparationPlan {
  // Reuse the frozen limit logic — never duplicated (gate §1). The FIRST violation's
  // specific code is surfaced (e.g. VIDEO_DURATION_EXCEEDED), never a generic error.
  const violations = checkSourceLimits(metadata);
  if (violations.length > 0) {
    throw new VideoPreparationError(violations[0].code, violations[0].message);
  }

  const recipeArgs = buildNormalizeFfmpegArgs(metadata, profile); // ref-free
  const transformations = buildTransformations(metadata, profile);
  const hasAudio = metadata.audioCodec !== null;

  const ffmpegArgs = recipeArgs.map((tok) =>
    tok === SOURCE_PLACEHOLDER ? refs.sourceRef : tok === OUTPUT_PLACEHOLDER ? refs.normalizedRef : tok,
  );

  const expectedOutput: PreparationPlan["expectedOutput"] = {
    width: profile.width,
    height: profile.height,
    fps: profile.fps,
    colorRange: "tv",
    videoCodec: "h264",
    audioCodec: hasAudio ? "aac" : null,
    pixelFormat: "yuv420p",
  };

  const preparationFingerprint = computeFingerprint({ metadata, profile, limits, transformations, recipeArgs });

  return {
    sourceRef: refs.sourceRef,
    normalizedRef: refs.normalizedRef,
    ffmpegArgs,
    transformations,
    expectedOutput,
    preparationFingerprint,
  };
}

// ---------------------------------------------------------------------------
// validatePreparedMetadata — assert a prepared file's probe meets the contract. Every
// failure maps to VIDEO_PREPARED_SOURCE_INVALID (never a generic error).
// `audioExpected`: when known (from the source), enforce present-aac vs. absent; when
// undefined, accept "aac or none".
// ---------------------------------------------------------------------------
export function validatePreparedMetadata(
  prepared: PreparedVideoProbe,
  profile: RenderProfileSpec,
  opts: { audioExpected?: boolean } = {},
): PreparedMetadataValidationResult {
  const violations: { check: string; message: string }[] = [];

  if (prepared.videoCodec === null || prepared.width <= 0 || prepared.height <= 0) {
    violations.push({ check: "video_stream", message: "prepared output has no usable video stream" });
  }
  if (prepared.width !== profile.width || prepared.height !== profile.height) {
    violations.push({
      check: "dimensions",
      message: `expected ${profile.width}×${profile.height}, got ${prepared.width}×${prepared.height}`,
    });
  }
  if (prepared.width % 2 !== 0 || prepared.height % 2 !== 0) {
    violations.push({ check: "even_dimensions", message: `prepared dimensions must be even, got ${prepared.width}×${prepared.height}` });
  }
  if (!Number.isFinite(prepared.fps) || Math.abs(prepared.fps - profile.fps) > PREPARED_FPS_TOLERANCE) {
    violations.push({ check: "fps", message: `expected ${profile.fps}fps (±${PREPARED_FPS_TOLERANCE}), got ${prepared.fps}` });
  }
  if (prepared.videoCodec !== "h264") {
    violations.push({ check: "video_codec", message: `expected h264, got ${prepared.videoCodec}` });
  }
  if (prepared.pixelFormat !== "yuv420p") {
    violations.push({ check: "pixel_format", message: `expected yuv420p, got ${prepared.pixelFormat}` });
  }
  // Range policy (fail-closed): "tv" is the normalized target; null (no VUI range signal)
  // is accepted because H.264 defines unspecified as limited range AND x264 only writes
  // the VUI colour block when the input carried colour metadata — both cases decode
  // identically. Anything else — "pc" above all — is a normalization failure, never
  // acceptable in a prepared file.
  if (prepared.colorRange !== "tv" && prepared.colorRange !== null) {
    violations.push({ check: "color_range", message: `expected tv or unspecified (limited), got ${prepared.colorRange}` });
  }
  if (prepared.rotationDegrees !== 0) {
    violations.push({ check: "residual_rotation", message: `prepared output has residual rotation ${prepared.rotationDegrees}° (must be 0)` });
  }
  if (!Number.isFinite(prepared.durationSeconds) || prepared.durationSeconds <= 0) {
    violations.push({ check: "duration", message: `prepared output has invalid duration ${prepared.durationSeconds}` });
  }

  if (opts.audioExpected === true) {
    if (prepared.audioCodec !== "aac") {
      violations.push({ check: "audio", message: `expected aac audio, got ${prepared.audioCodec ?? "none"}` });
    }
  } else if (opts.audioExpected === false) {
    if (prepared.audioCodec !== null) {
      violations.push({ check: "audio", message: `expected no audio, got ${prepared.audioCodec}` });
    }
  } else if (prepared.audioCodec !== null && prepared.audioCodec !== "aac") {
    violations.push({ check: "audio", message: `expected aac or no audio, got ${prepared.audioCodec}` });
  }

  const ok = violations.length === 0;
  return { ok, code: ok ? null : "VIDEO_PREPARED_SOURCE_INVALID", violations };
}

// ---------------------------------------------------------------------------
// Fingerprint — deterministic, derived ONLY from stable semantic content (schema version,
// recipe-relevant source metadata, profile, limits, transformations, ref-FREE recipe
// args). Operational refs are excluded, so equivalent plans with different temp refs share
// a fingerprint. Canonical (sorted-key) serialization → sha256.
// ---------------------------------------------------------------------------
function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

function computeFingerprint(input: {
  metadata: SourceVideoMetadata;
  profile: RenderProfileSpec;
  limits: VideoSourceLimits;
  transformations: readonly VideoTransformation[];
  recipeArgs: readonly string[];
}): string {
  const payload = {
    schemaVersion: PREPARATION_PLAN_SCHEMA_VERSION,
    profile: {
      id: input.profile.id,
      width: input.profile.width,
      height: input.profile.height,
      fps: input.profile.fps,
      videoCodec: input.profile.videoCodec,
      audioCodec: input.profile.audioCodec,
    },
    limits: {
      maxDurationSeconds: input.limits.maxDurationSeconds,
      maxFileBytes: input.limits.maxFileBytes,
      maxLongEdgePx: input.limits.maxLongEdgePx,
      maxShortEdgePx: input.limits.maxShortEdgePx,
      container: input.limits.container,
      videoCodec: input.limits.videoCodec,
      audioCodecs: [...input.limits.audioCodecs],
    },
    // Recipe-relevant source facts (NOT bytes — the recipe does not depend on file size).
    source: {
      container: input.metadata.container,
      videoCodec: input.metadata.videoCodec,
      audioCodec: input.metadata.audioCodec,
      width: input.metadata.width,
      height: input.metadata.height,
      fps: roundTo(input.metadata.fps, 3),
      durationSeconds: roundTo(input.metadata.durationSeconds, 3),
      rotationDegrees: input.metadata.rotationDegrees,
    },
    transformations: input.transformations,
    recipeArgs: input.recipeArgs, // ref-free (placeholders)
  };
  const json = JSON.stringify(canonicalize(payload));
  return `${PREPARATION_PLAN_SCHEMA_VERSION}:${createHash("sha256").update(json).digest("hex")}`;
}

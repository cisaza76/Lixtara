// F3-A Step 3 — the FFmpeg EXECUTION adapter: materializes a pure PreparationPlan's
// operational refs inside a sandbox, runs ffmpeg (command + array args — NEVER a shell
// string), probes the normalized output with ffprobe, validates it with the Step-2
// `validatePreparedMetadata`, and returns a PreparedVideoSource + execution provenance.
//
// LAYERING (Contract Freeze §8.3):   pure video-engine  →  THIS adapter  →  Vercel Sandbox
// This module is the ONLY place FFmpeg is actually executed. `prepare-video.ts` (pure)
// never touches a sandbox; this adapter never re-derives the recipe or re-computes the
// fingerprint — it consumes the plan.
//
// Boundary: no @/lib/creative-jobs, no Supabase, no StoragePort, no AssetStore, no
// Remotion. The Sandbox is an injected PORT (VideoPreparationSandbox) whose shape mirrors
// the real @vercel/sandbox surface the repo already uses (render-provider.ts) + qa.ts's
// FfprobeExecutor — a real Sandbox instance satisfies it structurally, and unit tests
// inject a fake. INVARIANT (server-only): depends on `node:crypto`/sandbox I/O — never
// import from a client component or browser bundle.
//
// This adapter does NOT decide which asset to use, query Supabase, authorize the user,
// download from a URL, or select a listing — it receives a source ALREADY authorized +
// materialized (gate §"Fuente").
import { createHash } from "node:crypto";
import type { SourceVideoMetadata } from "@/lib/video-engine/media-metadata";
import type { RenderProfileSpec } from "@/lib/video-engine/render-profiles";
import type { PreparedVideoSource } from "@/lib/video-engine/source-strategy";
import type { VideoErrorCode } from "@/lib/video-engine/video-errors";
import { isVideoErrorRetryable } from "@/lib/video-engine/video-errors";
import {
  SOURCE_PLACEHOLDER,
  OUTPUT_PLACEHOLDER,
  validatePreparedMetadata,
  describeTransformations,
  type PreparationPlan,
  type PreparedVideoProbe,
  type VideoTransformation,
} from "@/lib/video-engine/prepare-video";

// ---------------------------------------------------------------------------
// Sandbox PORT — the minimal surface this adapter needs, mirroring @vercel/sandbox
// (render-provider.ts) so a real Sandbox satisfies it structurally with no wrapper.
// ---------------------------------------------------------------------------
export interface SandboxCommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}
export interface VideoPreparationSandbox {
  writeFiles?(files: { path: string; content: Buffer }[]): Promise<void>;
  runCommand(command: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<SandboxCommandResult>;
  readFileToBuffer(opts: { path: string }): Promise<Buffer | null>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Named execution parameters (no magic numbers).
// ---------------------------------------------------------------------------
export const DEFAULT_FFMPEG_TIMEOUT_MS = 8 * 60 * 1000; // generous; a 60s source render is ~3-4 min (F2-D)
export const DEFAULT_FFPROBE_TIMEOUT_MS = 30 * 1000;
const MAX_CAPTURED_LOG_CHARS = 4000; // bounded stderr capture (mirrors render-provider.ts)
const COMMON_TIMEOUT_EXIT_CODE = 124; // `timeout(1)` convention

// ---------------------------------------------------------------------------
// Typed execution error — carries a FROZEN VideoErrorCode plus a machine `kind`. Retryable
// is DERIVED from the frozen catalog (never overridden here), so classification stays
// consistent with video-errors.ts. NB: a preparation *timeout* currently maps to
// VIDEO_PREPARATION_FAILED (the closest existing code) — see the Contract-Freeze note in
// the gate report; a dedicated retryable VIDEO_PREPARATION_TIMEOUT would need a freeze
// amendment (not taken here).
// ---------------------------------------------------------------------------
export type VideoPreparationFailureKind =
  | "invalid_path"
  | "unresolved_placeholder"
  | "ffmpeg_exec_failed"
  | "ffmpeg_timeout"
  | "output_missing"
  | "output_empty"
  | "ffprobe_failed"
  | "invalid_prepared_metadata";

export class VideoPreparationExecutionError extends Error {
  constructor(
    readonly code: VideoErrorCode,
    readonly kind: VideoPreparationFailureKind,
    message: string,
    // #112 — structured facts for the failure evidence pack (additive, optional).
    readonly detail?: { exitCode?: number },
  ) {
    super(message);
    this.name = "VideoPreparationExecutionError";
  }
  get retryable(): boolean {
    return isVideoErrorRetryable(this.code);
  }
}

// ---------------------------------------------------------------------------
// Provenance (gate §"Provenance"). Timestamps belong to EXECUTION provenance and MUST NOT
// enter the fingerprint (the plan's fingerprint is reused verbatim).
// ---------------------------------------------------------------------------
export interface VideoPreparationProvenance {
  preparationFingerprint: string;
  sourceHash: string;
  ffmpegVersion: string;
  ffprobeVersion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sourceBytes: number;
  preparedBytes: number;
  inputMetadata: SourceVideoMetadata;
  preparedMetadata: PreparedVideoProbe;
  transformations: readonly VideoTransformation[];
  commandArgsSanitized: readonly string[];
  // best-effort / when available:
  exitCode?: number;
  timeoutMs?: number;
  snapshotId?: string;
  peakMemoryBytes?: number;
}

export interface ExecuteVideoPreparationInput {
  sandbox: VideoPreparationSandbox;
  plan: PreparationPlan;
  profile: RenderProfileSpec;
  // Already-materialized, already-authorized source + intended output, inside the job
  // workspace (e.g. /tmp/video-jobs/<jobId>/source-0.mp4 and .../prepared-0.mp4).
  sourcePath: string;
  outputPath: string;
  expectedAudio: boolean;
  // Needed for the frozen PreparedVideoSource provenance (not re-derived here).
  sourceMetadata: SourceVideoMetadata;
  sourceSha256: string;
  baseArtifactVersion: string;
  timeoutMs?: number;
  snapshotId?: string;
  // Injected clock for deterministic tests; defaults to Date.now.
  now?: () => number;
}

export interface ExecuteVideoPreparationResult {
  preparedSource: PreparedVideoSource;
  preparedMetadata: PreparedVideoProbe;
  provenance: VideoPreparationProvenance;
}

// ---------------------------------------------------------------------------
// Safety helpers.
// ---------------------------------------------------------------------------

// Reject paths that could be mis-read as a flag or carry an injection/placeholder. Args go
// to the sandbox as a real ARRAY (no shell), so this is defense-in-depth, not the only
// guard.
function assertSafePath(label: string, p: string): void {
  if (!p || typeof p !== "string") throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "invalid_path", `${label} path is empty`);
  if (p.includes("\0")) throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "invalid_path", `${label} path contains a NUL byte`);
  if (p.includes("${")) throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "invalid_path", `${label} path contains a placeholder`);
  if (p.startsWith("-")) throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "invalid_path", `${label} path may not start with '-' (would be read as a flag)`);
  if (/(^|\/)\.\.(\/|$)/.test(p)) throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "invalid_path", `${label} path may not contain '..'`);
}

// Substitute the plan's operational refs / placeholders with the real sandbox paths, then
// prove nothing unresolved remains. Handles a plan whose refs are the placeholders OR
// concrete relative names — both resolve; a residual ${SOURCE}/${OUTPUT} is a hard error.
export function resolveFfmpegArgs(plan: PreparationPlan, sourcePath: string, outputPath: string): string[] {
  const resolved = plan.ffmpegArgs.map((tok) => {
    if (tok === SOURCE_PLACEHOLDER || tok === plan.sourceRef) return sourcePath;
    if (tok === OUTPUT_PLACEHOLDER || tok === plan.normalizedRef) return outputPath;
    return tok;
  });
  if (resolved.some((a) => a.includes(SOURCE_PLACEHOLDER) || a.includes(OUTPUT_PLACEHOLDER))) {
    throw new VideoPreparationExecutionError(
      "VIDEO_PREPARATION_FAILED",
      "unresolved_placeholder",
      "ffmpeg args still contain an unresolved ${SOURCE}/${OUTPUT} placeholder",
    );
  }
  return resolved;
}

// Defense-in-depth: strip anything URL-/secret-shaped from provenance (there is nothing
// sensitive in normalize args — just /tmp paths + ffmpeg flags — but never rely on that).
function sanitizeArgs(args: readonly string[]): string[] {
  return args.map((a) => a.replace(/https?:\/\/\S+/gi, "[url omitted]").replace(/sb_secret_\S+/gi, "[secret omitted]"));
}

function isTimeoutError(err: unknown, exitCode?: number): boolean {
  if (exitCode === COMMON_TIMEOUT_EXIT_CODE) return true;
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out");
}

// ---------------------------------------------------------------------------
// ffprobe JSON → PreparedVideoProbe (strict parse). Throws on structurally broken output
// (no streams / no video stream / unparseable) — the caller maps that to ffprobe_failed.
// ---------------------------------------------------------------------------
function parseRational(rate: unknown): number {
  if (typeof rate !== "string") return NaN;
  const [num, den] = rate.split("/").map(Number);
  if (!den) return num;
  return num / den;
}

function parseRotationDegrees(videoStream: Record<string, unknown>): number {
  // Modern ffprobe: side_data_list[].rotation (often negative). Legacy: tags.rotate.
  const sideData = Array.isArray(videoStream.side_data_list) ? (videoStream.side_data_list as Record<string, unknown>[]) : [];
  const dm = sideData.find((s) => typeof s.rotation === "number");
  const rawTag = (videoStream.tags as Record<string, unknown> | undefined)?.rotate;
  let deg = 0;
  if (dm && typeof dm.rotation === "number") deg = -Number(dm.rotation); // display-matrix rotation is the negative of the apply rotation
  else if (rawTag != null && Number.isFinite(Number(rawTag))) deg = Number(rawTag);
  deg = ((Math.round(deg) % 360) + 360) % 360;
  return deg;
}

export function parseFfprobeToPreparedProbe(jsonStr: string, fileBytes: number): PreparedVideoProbe {
  let json: unknown;
  try {
    json = JSON.parse(jsonStr);
  } catch {
    throw new Error("ffprobe output is not valid JSON");
  }
  if (!json || typeof json !== "object") throw new Error("ffprobe JSON is not an object");
  const root = json as { streams?: unknown; format?: Record<string, unknown> };
  const streams = Array.isArray(root.streams) ? (root.streams as Record<string, unknown>[]) : [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("ffprobe reported no video stream");

  const format = root.format ?? {};
  return {
    container: typeof format.format_name === "string" ? format.format_name : "",
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : null,
    audioCodec: audio && typeof audio.codec_name === "string" ? (audio.codec_name as string) : null,
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: parseRational(video.r_frame_rate),
    durationSeconds: Number(format.duration ?? (video.duration as string) ?? NaN),
    bytes: fileBytes,
    rotationDegrees: parseRotationDegrees(video),
    pixelFormat: typeof video.pix_fmt === "string" ? video.pix_fmt : null,
    colorRange: typeof video.color_range === "string" ? video.color_range : null,
  };
}

// ---------------------------------------------------------------------------
// Sandbox helpers (all via runCommand — command + array args, never a shell string).
// ---------------------------------------------------------------------------
async function toolVersion(sandbox: VideoPreparationSandbox, tool: "ffmpeg" | "ffprobe"): Promise<string> {
  try {
    const r = await sandbox.runCommand(tool, ["-version"], { timeoutMs: DEFAULT_FFPROBE_TIMEOUT_MS });
    if (r.exitCode !== 0) return "unknown";
    const first = (await r.stdout()).split("\n")[0]?.trim();
    return first || "unknown";
  } catch {
    return "unknown";
  }
}

async function statSizeBytes(sandbox: VideoPreparationSandbox, path: string): Promise<number | null> {
  try {
    const r = await sandbox.runCommand("stat", ["-c", "%s", path], { timeoutMs: DEFAULT_FFPROBE_TIMEOUT_MS });
    if (r.exitCode !== 0) return null;
    const n = Number((await r.stdout()).trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// executeVideoPreparation — run ffmpeg, verify+probe+validate the output, and build the
// PreparedVideoSource ONLY after: ffmpeg success + output exists + ffprobe parsed +
// validatePreparedMetadata success. Does NOT stop the sandbox or delete the output — the
// caller consumes the prepared file, and workspace/sandbox cleanup is the wrapper's job
// (see withPreparedVideo).
// ---------------------------------------------------------------------------
export async function executeVideoPreparation(
  input: ExecuteVideoPreparationInput,
): Promise<ExecuteVideoPreparationResult> {
  const now = input.now ?? (() => Date.now());
  const timeoutMs = input.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS;

  assertSafePath("source", input.sourcePath);
  assertSafePath("output", input.outputPath);

  const resolvedArgs = resolveFfmpegArgs(input.plan, input.sourcePath, input.outputPath);

  const ffmpegVersion = await toolVersion(input.sandbox, "ffmpeg");
  const ffprobeVersion = await toolVersion(input.sandbox, "ffprobe");

  const startedAtMs = now();

  // ---- 1. ffmpeg (command + array args; NO shell interpolation) ----
  let ffmpegResult: SandboxCommandResult;
  try {
    ffmpegResult = await input.sandbox.runCommand("ffmpeg", resolvedArgs, { timeoutMs });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "ffmpeg_timeout", `ffmpeg timed out after ${timeoutMs}ms`);
    }
    throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "ffmpeg_exec_failed", `ffmpeg execution error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (ffmpegResult.exitCode === COMMON_TIMEOUT_EXIT_CODE) {
    throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "ffmpeg_timeout", `ffmpeg timed out (exit ${COMMON_TIMEOUT_EXIT_CODE})`);
  }
  if (ffmpegResult.exitCode !== 0) {
    const stderr = (await ffmpegResult.stderr()).slice(-MAX_CAPTURED_LOG_CHARS);
    throw new VideoPreparationExecutionError("VIDEO_PREPARATION_FAILED", "ffmpeg_exec_failed", `ffmpeg failed (exit ${ffmpegResult.exitCode}): ${stderr}`, { exitCode: ffmpegResult.exitCode });
  }

  // ---- 2. verify output exists + positive size BEFORE ffprobe ----
  const preparedBytes = await statSizeBytes(input.sandbox, input.outputPath);
  if (preparedBytes === null) {
    throw new VideoPreparationExecutionError("VIDEO_PREPARED_SOURCE_INVALID", "output_missing", "ffmpeg reported success but the output file is missing");
  }
  if (preparedBytes <= 0) {
    throw new VideoPreparationExecutionError("VIDEO_PREPARED_SOURCE_INVALID", "output_empty", "ffmpeg produced an empty output file");
  }

  // ---- 3. ffprobe the output (only reached because ffmpeg succeeded) ----
  let probeStdout: string;
  try {
    const probe = await input.sandbox.runCommand(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input.outputPath],
      { timeoutMs: DEFAULT_FFPROBE_TIMEOUT_MS },
    );
    if (probe.exitCode !== 0) {
      const stderr = (await probe.stderr()).slice(-MAX_CAPTURED_LOG_CHARS);
      throw new Error(`ffprobe exit ${probe.exitCode}: ${stderr}`);
    }
    probeStdout = await probe.stdout();
  } catch (err) {
    throw new VideoPreparationExecutionError("VIDEO_PREPARED_SOURCE_INVALID", "ffprobe_failed", `ffprobe failed on prepared output: ${err instanceof Error ? err.message : String(err)}`);
  }

  let preparedMetadata: PreparedVideoProbe;
  try {
    preparedMetadata = parseFfprobeToPreparedProbe(probeStdout, preparedBytes);
  } catch (err) {
    throw new VideoPreparationExecutionError("VIDEO_PREPARED_SOURCE_INVALID", "ffprobe_failed", `could not parse prepared-output ffprobe: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---- 4. validate prepared metadata (Step-2 pure validator) — NEVER trust exit 0 alone ----
  const validation = validatePreparedMetadata(preparedMetadata, input.profile, { audioExpected: input.expectedAudio });
  if (!validation.ok) {
    throw new VideoPreparationExecutionError(
      "VIDEO_PREPARED_SOURCE_INVALID",
      "invalid_prepared_metadata",
      `prepared output failed validation: ${validation.violations.map((v) => v.check).join(", ")}`,
    );
  }

  const completedAtMs = now();

  // ---- 5. build PreparedVideoSource — ONLY now (success + exists + parsed + validated) ----
  const preparedSource: PreparedVideoSource = {
    path: input.outputPath, // internal, temporary, sandbox-scoped — never public/durable
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: preparedMetadata.durationSeconds,
    videoCodec: "h264",
    audioCodec: preparedMetadata.audioCodec === "aac" ? "aac" : null,
    hasAudio: preparedMetadata.audioCodec !== null,
    sourceHash: input.sourceSha256,
    preparationFingerprint: input.plan.preparationFingerprint, // reuse — never recompute
    sourceMetadata: input.sourceMetadata,
    transformations: describeTransformations(input.plan.transformations),
    ffmpegVersion,
    runtimeVersion: `${input.baseArtifactVersion} ffmpeg=${ffmpegVersion}`,
    preparedBytes,
  };

  const provenance: VideoPreparationProvenance = {
    preparationFingerprint: input.plan.preparationFingerprint,
    sourceHash: input.sourceSha256,
    ffmpegVersion,
    ffprobeVersion,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    sourceBytes: input.sourceMetadata.bytes,
    preparedBytes,
    inputMetadata: input.sourceMetadata,
    preparedMetadata,
    transformations: input.plan.transformations,
    commandArgsSanitized: sanitizeArgs(resolvedArgs),
    exitCode: ffmpegResult.exitCode,
    timeoutMs,
    snapshotId: input.snapshotId,
  };

  return { preparedSource, preparedMetadata, provenance };
}

// ---------------------------------------------------------------------------
// withPreparedVideo — managed-resource wrapper. Runs the preparation, lets the caller
// CONSUME the still-alive prepared output, THEN cleans the job workspace and stops the
// sandbox in `finally` (success AND failure). The consumer is where the render step will
// later read the prepared file — cleanup never happens before the consumer returns, so the
// returned path is never already-deleted (gate §"Cleanup").
// ---------------------------------------------------------------------------
export interface WithPreparedVideoOptions extends ExecuteVideoPreparationInput {
  workspaceDir: string; // e.g. /tmp/video-jobs/<jobId> — removed on completion
}

export async function withPreparedVideo<T>(
  input: WithPreparedVideoOptions,
  consume: (result: ExecuteVideoPreparationResult) => Promise<T>,
): Promise<T> {
  assertSafePath("workspace", input.workspaceDir);
  try {
    const result = await executeVideoPreparation(input);
    return await consume(result);
  } finally {
    // Cleanup on success AND failure — remove the whole job workspace, then release the
    // sandbox. Both are best-effort: a failed cleanup must not mask the original outcome.
    await input.sandbox.runCommand("rm", ["-rf", input.workspaceDir], { timeoutMs: DEFAULT_FFPROBE_TIMEOUT_MS }).catch(() => {});
    await input.sandbox.stop().catch(() => {});
  }
}

// Convenience: sha256 of source bytes (the caller usually has this from download; exported
// for callers that materialized the source in-process).
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

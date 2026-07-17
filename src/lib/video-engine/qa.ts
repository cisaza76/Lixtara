// Technical QA for a rendered video — pure parsing of a captured ffprobe payload, plus
// an injectable runner for the real thing. QA runs BEFORE any Asset row is created
// (produce-asset.ts enforces the exact order); this module only answers "is this MP4
// technically valid" — it never decides Creative Job state (no such import here).
import { createHash } from "node:crypto";

export interface ExpectedTechnicalSpec {
  container: string; // e.g. "mp4"
  codec: string; // e.g. "h264"
  width: number;
  height: number;
  fps: number; // e.g. 30
  durationSec: number; // expected duration
  toleranceSec: number; // allowed +/- drift before QA fails
}

export interface TechnicalQaResult {
  ok: boolean;
  container: string;
  codec: string;
  width: number;
  height: number;
  fps: string; // ffprobe's raw r_frame_rate string (e.g. "30/1")
  durationSec: number;
  bytes: number;
  checksumSha256: string;
  checks: Record<string, boolean>;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
}
interface FfprobeFormat {
  format_name?: string;
  duration?: string;
}
interface FfprobeJson {
  format?: FfprobeFormat;
  streams?: FfprobeStream[];
}

// ffprobe reports frame rate as a rational string ("30/1", "30000/1001", …).
function frameRateToNumber(rate: string | undefined): number {
  if (!rate) return NaN;
  const [num, den] = rate.split("/").map(Number);
  if (!den) return num;
  return num / den;
}

// Pure parser: no filesystem/network access. `bytes` is the ACTUAL rendered byte
// buffer — the checksum and bytes>0 check are computed from it directly (never
// trusted from ffprobe's own size/duration metadata), matching the Asset Manager's
// rule that a checksum is only ever set from real bytes (src/lib/assets/asset-manager.ts).
export function parseFfprobe(ffprobeJson: unknown, expected: ExpectedTechnicalSpec, bytes: Buffer): TechnicalQaResult {
  const probe = (ffprobeJson ?? {}) as FfprobeJson;
  const videoStream = probe.streams?.find((s) => s.codec_type === "video");

  const container = probe.format?.format_name ?? "";
  const codec = videoStream?.codec_name ?? "";
  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;
  const fps = videoStream?.r_frame_rate ?? "";
  const durationSec = Number(probe.format?.duration ?? videoStream?.duration ?? NaN);
  const fpsValue = frameRateToNumber(fps);

  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");

  // ffprobe's `format_name` for an MP4 is a comma-separated alias list
  // ("mov,mp4,m4a,3gp,3g2,mj2") — match by membership, not exact equality.
  const containerOk = container.split(",").includes(expected.container);

  const checks: Record<string, boolean> = {
    container: containerOk,
    codec: codec === expected.codec,
    width: width === expected.width,
    height: height === expected.height,
    fps: Number.isFinite(fpsValue) && Math.abs(fpsValue - expected.fps) < 0.01,
    duration: Number.isFinite(durationSec) && Math.abs(durationSec - expected.durationSec) <= expected.toleranceSec,
    bytesPositive: bytes.length > 0,
    decodable: Boolean(videoStream),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    container,
    codec,
    width,
    height,
    fps,
    durationSec,
    bytes: bytes.length,
    checksumSha256,
    checks,
  };
}

// The Storage object's content-type MUST be derived from what ffprobe actually
// detected — NEVER from the renderer's own claimed `RenderMediaOutput.mime`
// (produce-asset.ts deliberately never reads `renderOut.mime` for the upload call).
// A `TechnicalQaResult` that already failed QA (produce-asset.ts checks `.ok` first)
// never reaches this function in practice, but it re-validates container/codec itself
// rather than trusting the caller — matching this module's "verify the actual detected
// values, never assume" style — and throws (withholds a content-type) rather than
// fabricating one for anything that isn't a confirmed mp4/h264 render.
export function contentTypeFromQa(qa: TechnicalQaResult): string {
  const containerOk = qa.container.split(",").includes("mp4");
  const codecOk = qa.codec === "h264";
  if (!containerOk || !codecOk) {
    throw new Error(
      `contentTypeFromQa: QA result is not a confirmed mp4/h264 render (container="${qa.container}", codec="${qa.codec}") — refusing to derive a content-type`,
    );
  }
  return "video/mp4";
}

// Minimal duck-typed exec surface — structurally compatible with a real
// `@vercel/sandbox` `Sandbox` instance's `runCommand`, but this module deliberately
// has NO `@vercel/sandbox` import (only render-provider.ts depends on the SDK).
// Injectable so tests never open a real Sandbox.
export interface FfprobeExecutor {
  runCommand(
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>;
}

// Runs ffprobe in the sandbox via `sh -c` — per the P2.0 spike (§5.2), invoking a
// missing/failing binary directly throws an opaque SDK 400; `sh -c` always returns a
// clean exit code instead, which is what makes failure handling here reliable. Returns
// the parsed JSON for `parseFfprobe`; throws (rather than fabricating a result) if
// ffprobe itself fails.
export async function runFfprobe(exec: FfprobeExecutor, remoteMp4Path: string): Promise<unknown> {
  const result = await exec.runCommand("sh", [
    "-c",
    `ffprobe -v error -print_format json -show_format -show_streams ${remoteMp4Path}`,
  ]);
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    throw new Error(`ffprobe failed (exit ${result.exitCode}): ${stderr.slice(-2000)}`);
  }
  const stdout = await result.stdout();
  return JSON.parse(stdout);
}

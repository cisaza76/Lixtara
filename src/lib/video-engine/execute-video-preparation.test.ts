import { describe, it, expect } from "vitest";
import { getRenderProfile } from "./render-profiles";
import { VIDEO_SOURCE_LIMITS } from "./video-source-limits";
import type { SourceVideoMetadata } from "./media-metadata";
import {
  planVideoPreparation,
  SOURCE_PLACEHOLDER,
  OUTPUT_PLACEHOLDER,
  type PreparationPlan,
} from "./prepare-video";
import {
  executeVideoPreparation,
  withPreparedVideo,
  resolveFfmpegArgs,
  parseFfprobeToPreparedProbe,
  VideoPreparationExecutionError,
  type VideoPreparationSandbox,
  type SandboxCommandResult,
  type ExecuteVideoPreparationInput,
} from "./execute-video-preparation";

const STANDARD = getRenderProfile("standard");

function meta(overrides: Partial<SourceVideoMetadata> = {}): SourceVideoMetadata {
  return {
    container: "mov,mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12,
    bytes: 20 * 1024 * 1024,
    rotationDegrees: 0,
    ...overrides,
  };
}

// A plan whose refs ARE the placeholders (the execution model: plan carries ${SOURCE}/${OUTPUT},
// the adapter resolves them to real sandbox paths).
function planWithPlaceholders(m: SourceVideoMetadata = meta()): PreparationPlan {
  return planVideoPreparation(m, STANDARD, VIDEO_SOURCE_LIMITS, {
    sourceRef: SOURCE_PLACEHOLDER,
    normalizedRef: OUTPUT_PLACEHOLDER,
  });
}

function probeJson(o: {
  vcodec?: string;
  w?: number;
  h?: number;
  fps?: string;
  pix?: string | null;
  dur?: number;
  audio?: boolean;
  acodec?: string;
  rotate?: number;
} = {}): string {
  const video: Record<string, unknown> = {
    codec_type: "video",
    codec_name: o.vcodec ?? "h264",
    width: o.w ?? 1920,
    height: o.h ?? 1080,
    r_frame_rate: o.fps ?? "30/1",
    pix_fmt: o.pix === undefined ? "yuv420p" : o.pix,
  };
  if (o.rotate != null) video.side_data_list = [{ rotation: -o.rotate }]; // display-matrix = -applyRotation
  const streams: Record<string, unknown>[] = [video];
  if (o.audio !== false) streams.push({ codec_type: "audio", codec_name: o.acodec ?? "aac" });
  return JSON.stringify({ streams, format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: String(o.dur ?? 12) } });
}

interface FakeConfig {
  ffmpegExit?: number;
  ffmpegThrow?: Error;
  ffmpegStderr?: string;
  statOut?: string;
  statExit?: number;
  ffprobeExit?: number;
  ffprobeOut?: string;
  ffprobeThrow?: Error;
}
interface FakeSandbox extends VideoPreparationSandbox {
  calls: { command: string; args: readonly string[] }[];
  stopped: number;
  rmCalls: readonly string[][];
}

function result(exitCode: number, stdout: string, stderr = ""): SandboxCommandResult {
  return { exitCode, stdout: async () => stdout, stderr: async () => stderr };
}

function fakeSandbox(cfg: FakeConfig = {}): FakeSandbox {
  const calls: { command: string; args: readonly string[] }[] = [];
  const rmCalls: string[][] = [];
  let stopped = 0;
  const sb: FakeSandbox = {
    calls,
    rmCalls,
    get stopped() {
      return stopped;
    },
    async writeFiles() {},
    async runCommand(command, args) {
      calls.push({ command, args });
      const a = [...args];
      if (a.includes("-version")) return result(0, `${command} version 8.1.2-fake`);
      if (command === "ffmpeg") {
        if (cfg.ffmpegThrow) throw cfg.ffmpegThrow;
        return result(cfg.ffmpegExit ?? 0, "", cfg.ffmpegStderr ?? "");
      }
      if (command === "stat") return result(cfg.statExit ?? 0, cfg.statOut ?? "123456");
      if (command === "ffprobe") {
        if (cfg.ffprobeThrow) throw cfg.ffprobeThrow;
        return result(cfg.ffprobeExit ?? 0, cfg.ffprobeOut ?? probeJson());
      }
      if (command === "rm") {
        rmCalls.push(a);
        return result(0, "");
      }
      return result(0, "");
    },
    async readFileToBuffer() {
      return Buffer.from("x");
    },
    async stop() {
      stopped += 1;
    },
  };
  return sb;
}

function baseInput(sandbox: VideoPreparationSandbox, over: Partial<ExecuteVideoPreparationInput> = {}): ExecuteVideoPreparationInput {
  let clock = 0;
  return {
    sandbox,
    plan: planWithPlaceholders(),
    profile: STANDARD,
    sourcePath: "/tmp/video-jobs/j1/source-0.mp4",
    outputPath: "/tmp/video-jobs/j1/prepared-0.mp4",
    expectedAudio: true,
    sourceMetadata: meta(),
    sourceSha256: "abc123def",
    baseArtifactVersion: "base-2026-07-21",
    snapshotId: "snap_fake",
    now: () => (clock += 1000),
    ...over,
  };
}

const ffmpegRenderCalls = (sb: FakeSandbox) => sb.calls.filter((c) => c.command === "ffmpeg" && !c.args.includes("-version"));
const ffprobeProbeCalls = (sb: FakeSandbox) => sb.calls.filter((c) => c.command === "ffprobe" && c.args.includes("-show_streams"));

describe("1. placeholder substitution", () => {
  it("resolves ${SOURCE}/${OUTPUT} to the real sandbox paths in the ffmpeg call", async () => {
    const sb = fakeSandbox();
    await executeVideoPreparation(baseInput(sb));
    const ff = ffmpegRenderCalls(sb)[0];
    expect(ff.args).toContain("/tmp/video-jobs/j1/source-0.mp4");
    expect(ff.args).toContain("/tmp/video-jobs/j1/prepared-0.mp4");
    expect(ff.args.some((a) => a.includes(SOURCE_PLACEHOLDER) || a.includes(OUTPUT_PLACEHOLDER))).toBe(false);
  });
});

describe("2. reject unresolved placeholder", () => {
  it("throws when a placeholder survives substitution", () => {
    const plan = planWithPlaceholders();
    const broken: PreparationPlan = { ...plan, ffmpegArgs: [...plan.ffmpegArgs, `wrapper${OUTPUT_PLACEHOLDER}suffix`] };
    expect(() => resolveFfmpegArgs(broken, "/s.mp4", "/o.mp4")).toThrow(VideoPreparationExecutionError);
    try {
      resolveFfmpegArgs(broken, "/s.mp4", "/o.mp4");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).kind).toBe("unresolved_placeholder");
    }
  });
});

describe("3. args passed as array, never a shell string", () => {
  it("invokes command 'ffmpeg' with an array; never 'sh -c'", async () => {
    const sb = fakeSandbox();
    await executeVideoPreparation(baseInput(sb));
    const ff = ffmpegRenderCalls(sb)[0];
    expect(ff.command).toBe("ffmpeg");
    expect(Array.isArray(ff.args)).toBe(true);
    expect(ff.args[0]).toBe("-hide_banner");
    // no shell wrapper anywhere
    expect(sb.calls.some((c) => c.command === "sh")).toBe(false);
    // the whole arg vector is never collapsed into one space-joined command token
    expect(ff.args.some((a) => a === `ffmpeg ${ff.args.join(" ")}`)).toBe(false);
  });
});

describe("4/5/6. ffmpeg exit handling", () => {
  it("4. exit 0 succeeds", async () => {
    const r = await executeVideoPreparation(baseInput(fakeSandbox()));
    expect(r.preparedSource.path).toBe("/tmp/video-jobs/j1/prepared-0.mp4");
  });
  it("5. non-zero exit → VIDEO_PREPARATION_FAILED / ffmpeg_exec_failed", async () => {
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ ffmpegExit: 1, ffmpegStderr: "boom" })));
      throw new Error("should throw");
    } catch (e) {
      const err = e as VideoPreparationExecutionError;
      expect(err.code).toBe("VIDEO_PREPARATION_FAILED");
      expect(err.kind).toBe("ffmpeg_exec_failed");
      expect(err.retryable).toBe(false);
    }
  });
  it("6. timeout (thrown) → ffmpeg_timeout; and exit 124 → ffmpeg_timeout", async () => {
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ ffmpegThrow: new Error("command timed out") })));
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).kind).toBe("ffmpeg_timeout");
    }
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ ffmpegExit: 124 })));
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).kind).toBe("ffmpeg_timeout");
    }
  });
});

describe("7/8. output existence + size", () => {
  it("7. missing output → VIDEO_PREPARED_SOURCE_INVALID / output_missing", async () => {
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ statExit: 1 })));
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).code).toBe("VIDEO_PREPARED_SOURCE_INVALID");
      expect((e as VideoPreparationExecutionError).kind).toBe("output_missing");
    }
  });
  it("8. empty output → output_empty", async () => {
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ statOut: "0" })));
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).kind).toBe("output_empty");
    }
  });
});

describe("9/10. probe + validation", () => {
  it("9. invalid ffprobe JSON → ffprobe_failed", async () => {
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ ffprobeOut: "not-json{{" })));
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).kind).toBe("ffprobe_failed");
      expect((e as VideoPreparationExecutionError).code).toBe("VIDEO_PREPARED_SOURCE_INVALID");
    }
  });
  it("10. prepared metadata invalid (wrong dims) → invalid_prepared_metadata", async () => {
    try {
      await executeVideoPreparation(baseInput(fakeSandbox({ ffprobeOut: probeJson({ w: 1280, h: 720 }) })));
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationExecutionError).code).toBe("VIDEO_PREPARED_SOURCE_INVALID");
      expect((e as VideoPreparationExecutionError).kind).toBe("invalid_prepared_metadata");
    }
  });
});

describe("11/12. valid outputs (audio / no audio)", () => {
  it("11. valid with audio", async () => {
    const r = await executeVideoPreparation(baseInput(fakeSandbox({ ffprobeOut: probeJson({ audio: true }) })));
    expect(r.preparedSource.hasAudio).toBe(true);
    expect(r.preparedSource.audioCodec).toBe("aac");
    expect(r.preparedMetadata.width).toBe(1920);
  });
  it("12. valid without audio (expectedAudio false)", async () => {
    const r = await executeVideoPreparation(
      baseInput(fakeSandbox({ ffprobeOut: probeJson({ audio: false }) }), { expectedAudio: false }),
    );
    expect(r.preparedSource.hasAudio).toBe(false);
    expect(r.preparedSource.audioCodec).toBeNull();
  });
});

describe("13. fingerprint propagation (reused from plan, not recomputed)", () => {
  it("preparedSource + provenance carry the plan's fingerprint verbatim", async () => {
    const input = baseInput(fakeSandbox());
    const r = await executeVideoPreparation(input);
    expect(r.preparedSource.preparationFingerprint).toBe(input.plan.preparationFingerprint);
    expect(r.provenance.preparationFingerprint).toBe(input.plan.preparationFingerprint);
  });
});

describe("14. provenance sanitization", () => {
  it("redacts URL/secret-shaped tokens from commandArgsSanitized", async () => {
    const plan = planWithPlaceholders();
    const withSecret: PreparationPlan = {
      ...plan,
      ffmpegArgs: [...plan.ffmpegArgs, "http://signed.example/x?token=1", "sb_secret_abc"],
    };
    const r = await executeVideoPreparation(baseInput(fakeSandbox(), { plan: withSecret }));
    const joined = r.provenance.commandArgsSanitized.join(" ");
    expect(joined).toContain("[url omitted]");
    expect(joined).toContain("[secret omitted]");
    expect(joined).not.toContain("sb_secret_abc");
  });
  it("timestamps are present in provenance but not in the fingerprint", async () => {
    const input = baseInput(fakeSandbox());
    const r = await executeVideoPreparation(input);
    expect(r.provenance.startedAt).toMatch(/T.*Z$/);
    expect(r.provenance.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.provenance.preparationFingerprint).not.toContain(r.provenance.startedAt);
  });
});

describe("15/16. workspace lifecycle (withPreparedVideo)", () => {
  it("15. cleanup on success: consumer runs, then rm workspace + stop sandbox", async () => {
    const sb = fakeSandbox();
    let consumed = false;
    const out = await withPreparedVideo({ ...baseInput(sb), workspaceDir: "/tmp/video-jobs/j1" }, async (res) => {
      consumed = true;
      // the prepared output path is still alive when the consumer runs
      expect(res.preparedSource.path).toBe("/tmp/video-jobs/j1/prepared-0.mp4");
      return "done";
    });
    expect(out).toBe("done");
    expect(consumed).toBe(true);
    expect(sb.rmCalls).toContainEqual(["-rf", "/tmp/video-jobs/j1"]);
    expect(sb.stopped).toBe(1);
  });
  it("16. cleanup on failure: consumer NOT run, workspace + sandbox still released", async () => {
    const sb = fakeSandbox({ ffmpegExit: 1 });
    let consumed = false;
    await expect(
      withPreparedVideo({ ...baseInput(sb), workspaceDir: "/tmp/video-jobs/j1" }, async () => {
        consumed = true;
        return "x";
      }),
    ).rejects.toBeInstanceOf(VideoPreparationExecutionError);
    expect(consumed).toBe(false);
    expect(sb.rmCalls).toContainEqual(["-rf", "/tmp/video-jobs/j1"]);
    expect(sb.stopped).toBe(1);
  });
  it("executeVideoPreparation alone does NOT stop the sandbox (caller owns lifecycle)", async () => {
    const sb = fakeSandbox();
    await executeVideoPreparation(baseInput(sb));
    expect(sb.stopped).toBe(0);
  });
});

describe("17. ffprobe is not run when ffmpeg fails", () => {
  it("no -show_streams probe after a non-zero ffmpeg exit", async () => {
    const sb = fakeSandbox({ ffmpegExit: 1 });
    await expect(executeVideoPreparation(baseInput(sb))).rejects.toBeInstanceOf(VideoPreparationExecutionError);
    expect(ffprobeProbeCalls(sb).length).toBe(0);
  });
});

describe("18. PreparedVideoSource is built only after valid QA", () => {
  it("invalid metadata yields NO result (throws before building preparedSource)", async () => {
    const sb = fakeSandbox({ ffprobeOut: probeJson({ vcodec: "hevc" }) });
    await expect(executeVideoPreparation(baseInput(sb))).rejects.toMatchObject({
      code: "VIDEO_PREPARED_SOURCE_INVALID",
      kind: "invalid_prepared_metadata",
    });
  });
  it("residual rotation in the prepared output is rejected", async () => {
    const sb = fakeSandbox({ ffprobeOut: probeJson({ rotate: 90 }) });
    await expect(executeVideoPreparation(baseInput(sb))).rejects.toMatchObject({ kind: "invalid_prepared_metadata" });
  });
});

describe("parseFfprobeToPreparedProbe (strict)", () => {
  it("parses a valid probe with rotation normalized to 0..359", () => {
    const p = parseFfprobeToPreparedProbe(probeJson({ rotate: 90 }), 999);
    expect(p).toMatchObject({ videoCodec: "h264", width: 1920, height: 1080, fps: 30, pixelFormat: "yuv420p", rotationDegrees: 90, bytes: 999 });
  });
  it("throws when there is no video stream", () => {
    const noVideo = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "aac" }], format: { format_name: "mp4" } });
    expect(() => parseFfprobeToPreparedProbe(noVideo, 1)).toThrow();
  });
  it("reports audioCodec null when no audio stream", () => {
    expect(parseFfprobeToPreparedProbe(probeJson({ audio: false }), 1).audioCodec).toBeNull();
  });
});

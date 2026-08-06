import { describe, it, expect } from "vitest";
import {
  VIDEO_SOURCE_LIMITS,
  VIDEO_OUTPUT_SPEC,
  VIDEO_LIMIT_RECONCILIATION,
  checkSourceLimits,
  firstSourceLimitViolation,
  sortedEdges,
} from "./video-source-limits";
import type { SourceVideoMetadata } from "./media-metadata";

// A within-limits baseline (16:9 1080p h264/aac, 30s, 50 MB).
const OK: SourceVideoMetadata = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  videoCodec: "h264",
  audioCodec: "aac",
  width: 1920,
  height: 1080,
  fps: 30,
  durationSeconds: 30,
  bytes: 50 * 1024 * 1024,
  rotationDegrees: 0,
};

describe("VIDEO_SOURCE_LIMITS — named, unit-clear values (gate §10)", () => {
  it("pins the provisional MVP envelope", () => {
    expect(VIDEO_SOURCE_LIMITS.maxDurationSeconds).toBe(60);
    expect(VIDEO_SOURCE_LIMITS.maxFileBytes).toBe(300 * 1024 * 1024);
    expect(VIDEO_SOURCE_LIMITS.maxLongEdgePx).toBe(3840);
    expect(VIDEO_SOURCE_LIMITS.maxShortEdgePx).toBe(2160);
    expect(VIDEO_SOURCE_LIMITS.containers).toEqual(["mp4", "mov"]);
    expect(VIDEO_SOURCE_LIMITS.videoCodec).toBe("h264");
    expect(VIDEO_SOURCE_LIMITS.audioCodecs).toEqual(["aac"]);
    expect(VIDEO_SOURCE_LIMITS.videoStreamRequired).toBe(true);
    expect(VIDEO_SOURCE_LIMITS.audioStreamRequired).toBe(false);
  });
  it("output spec is 1920×1080/30 h264/aac", () => {
    expect(VIDEO_OUTPUT_SPEC).toMatchObject({ width: 1920, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac" });
  });
  it("input cap is stricter than and below the output storage ceiling", () => {
    expect(VIDEO_LIMIT_RECONCILIATION.inputCapBytes).toBeLessThan(VIDEO_LIMIT_RECONCILIATION.outputCeilingBytes);
  });
});

describe("checkSourceLimits — a within-limits source passes", () => {
  it("no violations for the baseline", () => {
    expect(checkSourceLimits(OK)).toEqual([]);
    expect(firstSourceLimitViolation(OK)).toBeNull();
  });
  it("audio is optional — no audio still passes", () => {
    expect(checkSourceLimits({ ...OK, audioCodec: null })).toEqual([]);
  });
});

describe("checkSourceLimits — each reject path maps to the right VIDEO_* code", () => {
  it("missing video stream", () => {
    const out = checkSourceLimits({ ...OK, videoCodec: null, width: 0, height: 0 });
    expect(out.map((v) => v.code)).toEqual(["VIDEO_STREAM_MISSING"]);
  });
  it("unsupported container", () => {
    const out = checkSourceLimits({ ...OK, container: "matroska,webm" });
    expect(out.some((v) => v.code === "VIDEO_CONTAINER_UNSUPPORTED")).toBe(true);
  });
  it("unsupported video codec", () => {
    const out = checkSourceLimits({ ...OK, videoCodec: "hevc" });
    expect(out.some((v) => v.code === "VIDEO_CODEC_UNSUPPORTED")).toBe(true);
  });
  it("unsupported audio codec (present but not aac)", () => {
    const out = checkSourceLimits({ ...OK, audioCodec: "opus" });
    expect(out.some((v) => v.code === "VIDEO_CODEC_UNSUPPORTED")).toBe(true);
  });
  it("duration exceeded", () => {
    const out = checkSourceLimits({ ...OK, durationSeconds: 61 });
    expect(out.some((v) => v.code === "VIDEO_DURATION_EXCEEDED")).toBe(true);
    expect(checkSourceLimits({ ...OK, durationSeconds: 60 })).toEqual([]); // exactly at the cap is OK
  });
  it("file too large", () => {
    const out = checkSourceLimits({ ...OK, bytes: 300 * 1024 * 1024 + 1 });
    expect(out.some((v) => v.code === "VIDEO_FILE_TOO_LARGE")).toBe(true);
  });
  it("messages carry the number + unit unambiguously", () => {
    const out = checkSourceLimits({ ...OK, durationSeconds: 90 });
    expect(out[0].message).toMatch(/90s exceeds the maximum of 60s/);
  });
});

describe("resolution — orientation-agnostic 4K (gate §10 clarification)", () => {
  it("sortedEdges is orientation-agnostic", () => {
    expect(sortedEdges(3840, 2160)).toEqual({ longEdge: 3840, shortEdge: 2160 });
    expect(sortedEdges(2160, 3840)).toEqual({ longEdge: 3840, shortEdge: 2160 });
  });
  it("accepts horizontal 4K (3840×2160)", () => {
    expect(checkSourceLimits({ ...OK, width: 3840, height: 2160 })).toEqual([]);
  });
  it("accepts VERTICAL 4K (2160×3840) — the limit is on dimensions, not orientation", () => {
    expect(checkSourceLimits({ ...OK, width: 2160, height: 3840 })).toEqual([]);
  });
  it("rejects 8K in either orientation", () => {
    expect(checkSourceLimits({ ...OK, width: 7680, height: 4320 }).some((v) => v.code === "VIDEO_RESOLUTION_EXCEEDED")).toBe(true);
    expect(checkSourceLimits({ ...OK, width: 4320, height: 7680 }).some((v) => v.code === "VIDEO_RESOLUTION_EXCEEDED")).toBe(true);
  });
  it("rejects an ultra-wide whose short edge is fine but long edge exceeds 3840", () => {
    expect(checkSourceLimits({ ...OK, width: 5120, height: 1440 }).some((v) => v.code === "VIDEO_RESOLUTION_EXCEEDED")).toBe(true);
  });
});

describe("checkSourceLimits — multiple simultaneous violations are all reported", () => {
  it("collects every violation, not just the first", () => {
    const out = checkSourceLimits({ ...OK, videoCodec: "hevc", durationSeconds: 120, bytes: 400 * 1024 * 1024 });
    const codes = out.map((v) => v.code);
    expect(codes).toContain("VIDEO_CODEC_UNSUPPORTED");
    expect(codes).toContain("VIDEO_DURATION_EXCEEDED");
    expect(codes).toContain("VIDEO_FILE_TOO_LARGE");
  });
});

// ---- Etapa 1 — MOV/H.264 SDR aceptado; HEVC y HDR rechazados fail-closed -----------
// Fixture equivalente al archivo real del owner (iPhone 16 Pro, IMG_6371.MOV):
// mov/h264 High, 1920x1080, yuv420p, tv, bt709 en las tres dimensiones, ~29.97 fps,
// 26.12 s, 48.412.268 bytes, sin HDR.
const IPHONE_MOV_SDR: SourceVideoMetadata = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  videoCodec: "h264",
  audioCodec: "aac",
  width: 1920,
  height: 1080,
  fps: 29.97,
  durationSeconds: 26.12,
  bytes: 48_412_268,
  rotationDegrees: 0,
  colorTransfer: "bt709",
  colorPrimaries: "bt709",
  colorSpace: "bt709",
  dolbyVision: false,
};

describe("Etapa 1 — el archivo real del iPhone pasa sin violaciones", () => {
  it("MOV/H.264 SDR dentro de límites: cero violaciones", () => {
    expect(checkSourceLimits(IPHONE_MOV_SDR)).toEqual([]);
  });

  it("el contenedor MOV es aceptado explícitamente (no por accidente del alias mp4)", () => {
    expect([...VIDEO_SOURCE_LIMITS.containers].sort()).toEqual(["mov", "mp4"]);
    // un contenedor realmente ajeno sigue siendo rechazado
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, container: "matroska,webm" })?.code).toBe(
      "VIDEO_CONTAINER_UNSUPPORTED",
    );
  });
});

describe("Etapa 1 — HEVC sigue rechazado (habilitación diferida a Etapa 2)", () => {
  it("hevc → VIDEO_CODEC_UNSUPPORTED", () => {
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, videoCodec: "hevc" })?.code).toBe("VIDEO_CODEC_UNSUPPORTED");
  });
});

describe("Etapa 1 — HDR rechazado fail-closed, con código propio", () => {
  it("HDR10 (smpte2084) → VIDEO_HDR_UNSUPPORTED", () => {
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, colorTransfer: "smpte2084" })?.code).toBe(
      "VIDEO_HDR_UNSUPPORTED",
    );
  });
  it("HLG (arib-std-b67) → VIDEO_HDR_UNSUPPORTED", () => {
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, colorTransfer: "arib-std-b67" })?.code).toBe(
      "VIDEO_HDR_UNSUPPORTED",
    );
  });
  it("primarios/espacio bt2020 → VIDEO_HDR_UNSUPPORTED", () => {
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, colorPrimaries: "bt2020" })?.code).toBe("VIDEO_HDR_UNSUPPORTED");
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, colorSpace: "bt2020nc" })?.code).toBe("VIDEO_HDR_UNSUPPORTED");
  });
  it("Dolby Vision (side_data) → VIDEO_HDR_UNSUPPORTED", () => {
    expect(firstSourceLimitViolation({ ...IPHONE_MOV_SDR, dolbyVision: true })?.code).toBe("VIDEO_HDR_UNSUPPORTED");
  });
  it("señal AUSENTE no se trata como HDR (positive-signal-only, misma postura que ADR-0011)", () => {
    const untagged = { ...IPHONE_MOV_SDR, colorTransfer: null, colorPrimaries: null, colorSpace: null };
    expect(checkSourceLimits(untagged)).toEqual([]);
    const legacy = { ...IPHONE_MOV_SDR };
    delete (legacy as { colorTransfer?: unknown }).colorTransfer;
    expect(checkSourceLimits(legacy)).toEqual([]);
  });
  it("el mensaje es técnico pero no expone comandos ni rutas internas", () => {
    const msg = firstSourceLimitViolation({ ...IPHONE_MOV_SDR, colorTransfer: "smpte2084" })?.message ?? "";
    expect(msg.toLowerCase()).toContain("hdr");
    expect(msg).not.toContain("/");
  });
});

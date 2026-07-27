import { describe, it, expect } from "vitest";
import { getRenderProfile, type RenderProfileSpec } from "./render-profiles";
import { VIDEO_SOURCE_LIMITS } from "./video-source-limits";
import type { SourceVideoMetadata } from "./media-metadata";
import {
  buildNormalizeFfmpegArgs,
  planVideoPreparation,
  validatePreparedMetadata,
  effectiveDimensions,
  isEffectively169,
  buildTransformations,
  describeTransformations,
  VideoPreparationError,
  BLUR_SIGMA,
  ENCODE_PARAMS,
  SOURCE_PLACEHOLDER,
  OUTPUT_PLACEHOLDER,
  type PreparedVideoProbe,
} from "./prepare-video";

const STANDARD = getRenderProfile("standard");
const REFS = { sourceRef: "source-0.mp4", normalizedRef: "prepared-0.mp4" };

function meta(overrides: Partial<SourceVideoMetadata> = {}): SourceVideoMetadata {
  return {
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 30,
    bytes: 50 * 1024 * 1024,
    rotationDegrees: 0,
    ...overrides,
  };
}

// --- semantic helpers over the arg vector (avoid brittle whole-string snapshots) ---
function args(m: SourceVideoMetadata, profile: RenderProfileSpec = STANDARD): string[] {
  return [...buildNormalizeFfmpegArgs(m, profile)];
}
function graphOf(a: string[]): string {
  return a[a.indexOf("-filter_complex") + 1];
}
function hasSeq(a: string[], seq: string[]): boolean {
  for (let i = 0; i + seq.length <= a.length; i++) {
    if (seq.every((t, j) => a[i + j] === t)) return true;
  }
  return false;
}

describe("orientation geometry (rotation swaps width/height — gate §2)", () => {
  it("0°/180° keep dims; 90°/270° swap", () => {
    expect(effectiveDimensions(meta({ width: 1920, height: 1080, rotationDegrees: 0 }))).toEqual({ width: 1920, height: 1080 });
    expect(effectiveDimensions(meta({ width: 1920, height: 1080, rotationDegrees: 180 }))).toEqual({ width: 1920, height: 1080 });
    expect(effectiveDimensions(meta({ width: 1080, height: 1920, rotationDegrees: 90 }))).toEqual({ width: 1920, height: 1080 });
    expect(effectiveDimensions(meta({ width: 1080, height: 1920, rotationDegrees: 270 }))).toEqual({ width: 1920, height: 1080 });
  });
  it("effective 16:9 detection uses rotated dims", () => {
    expect(isEffectively169(meta({ width: 1080, height: 1920, rotationDegrees: 90 }), STANDARD)).toBe(true); // rotates to 1920×1080
    expect(isEffectively169(meta({ width: 1080, height: 1920, rotationDegrees: 0 }), STANDARD)).toBe(false); // stays vertical
  });
});

describe("arg vector — canonical order + structure (quality)", () => {
  it("orders input → filter → maps → codec → output; -noautorotate precedes -i", () => {
    const a = args(meta());
    const iIn = a.indexOf("-i");
    expect(a.indexOf("-noautorotate")).toBeLessThan(iIn);
    expect(a.indexOf("-filter_complex")).toBeGreaterThan(iIn);
    expect(a.indexOf("-map")).toBeGreaterThan(a.indexOf("-filter_complex"));
    expect(a.indexOf("-c:v")).toBeGreaterThan(a.indexOf("-map"));
    expect(a[a.length - 1]).toBe(OUTPUT_PLACEHOLDER);
    expect(a[iIn + 1]).toBe(SOURCE_PLACEHOLDER);
  });
  it("maps the composited video label + always yuv420p + strips input metadata/rotation", () => {
    const a = args(meta());
    expect(hasSeq(a, ["-map", "[v]"])).toBe(true);
    expect(hasSeq(a, ["-pix_fmt", "yuv420p"])).toBe(true);
    expect(hasSeq(a, ["-map_metadata", "-1"])).toBe(true);
    expect(hasSeq(a, ["-metadata:s:v:0", "rotate=0"])).toBe(true);
    expect(hasSeq(a, ["-c:v", ENCODE_PARAMS.videoCodec])).toBe(true);
  });
  it("recipe is ref-free (placeholders, not real refs) — fingerprint stability basis", () => {
    const a = args(meta());
    expect(a).toContain(SOURCE_PLACEHOLDER);
    expect(a).toContain(OUTPUT_PLACEHOLDER);
    expect(a).not.toContain("source-0.mp4");
  });
});

describe("1. 1920×1080 30fps aac — 16:9 passthrough-normalize", () => {
  it("scale-fit + pad, no blurred-fill, keeps audio", () => {
    const g = graphOf(args(meta()));
    expect(g).toContain("force_original_aspect_ratio=decrease");
    expect(g).toContain(`pad=1920:1080`);
    expect(g).not.toContain("gblur");
    expect(g).not.toContain("split");
    expect(hasSeq(args(meta()), ["-map", "0:a:0"])).toBe(true);
    expect(hasSeq(args(meta()), ["-c:a", "aac"])).toBe(true);
  });
});

describe("2. 1280×720 24fps — 16:9, upscales, fps 24→30", () => {
  it("16:9 branch + fps transformation recorded", () => {
    const m = meta({ width: 1280, height: 720, fps: 24 });
    expect(isEffectively169(m, STANDARD)).toBe(true);
    expect(graphOf(args(m))).toContain("fps=30");
    expect(buildTransformations(m, STANDARD)).toContainEqual({ kind: "fps", from: 24, to: 30 });
  });
});

describe("3. vertical 1080×1920 — blurred-fill", () => {
  it("split bg/fg, gblur, contained fg, centered overlay", () => {
    const g = graphOf(args(meta({ width: 1080, height: 1920 })));
    expect(g).toContain("split=2");
    expect(g).toContain(`gblur=sigma=${BLUR_SIGMA}`);
    expect(g).toContain("force_original_aspect_ratio=increase"); // bg cover
    expect(g).toContain("force_original_aspect_ratio=decrease"); // fg contain
    expect(g).toContain("overlay=(W-w)/2:(H-h)/2");
    expect(buildTransformations(meta({ width: 1080, height: 1920 }), STANDARD).some((t) => t.kind === "blurred_fill")).toBe(true);
  });
});

describe("4. vertical 2160×3840 (4K) — blurred-fill, within limits", () => {
  it("blurred-fill branch and a valid plan (4K vertical accepted)", () => {
    const m = meta({ width: 2160, height: 3840, bytes: 200 * 1024 * 1024 });
    expect(graphOf(args(m))).toContain("gblur");
    expect(() => planVideoPreparation(m, STANDARD, VIDEO_SOURCE_LIMITS, REFS)).not.toThrow();
  });
});

describe("5/6/7. rotation baked physically + geometry from rotated dims", () => {
  it("90° → transpose=1 prefix, effective 16:9", () => {
    const g = graphOf(args(meta({ width: 1080, height: 1920, rotationDegrees: 90 })));
    expect(g.startsWith("[0:v]transpose=1,")).toBe(true);
    expect(g).toContain("pad=1920:1080"); // effective 1920×1080 → 16:9 branch
  });
  it("270° → transpose=2 prefix", () => {
    const g = graphOf(args(meta({ width: 1080, height: 1920, rotationDegrees: 270 })));
    expect(g.startsWith("[0:v]transpose=2,")).toBe(true);
  });
  it("180° → double transpose prefix", () => {
    const g = graphOf(args(meta({ width: 1920, height: 1080, rotationDegrees: 180 })));
    expect(g.startsWith("[0:v]transpose=1,transpose=1,")).toBe(true);
  });
  it("records rotate + strip-rotation-metadata transformations", () => {
    const t = buildTransformations(meta({ rotationDegrees: 90 }), STANDARD);
    expect(t).toContainEqual({ kind: "rotate", degrees: 90 });
    expect(t).toContainEqual({ kind: "strip_rotation_metadata" });
  });
});

describe("8. odd dimensions → even, deterministic canvas completion", () => {
  it("force_divisible_by=2 + pad, even expected output", () => {
    const m = meta({ width: 1281, height: 721 }); // ~16:9 but odd
    const g = graphOf(args(m));
    expect(g).toContain("force_divisible_by=2");
    const plan = planVideoPreparation(m, STANDARD, VIDEO_SOURCE_LIMITS, REFS);
    expect(plan.expectedOutput.width % 2).toBe(0);
    expect(plan.expectedOutput.height % 2).toBe(0);
  });
});

describe("9. square 1080×1080 — blurred-fill", () => {
  it("non-16:9 → blurred-fill", () => {
    expect(isEffectively169(meta({ width: 1080, height: 1080 }), STANDARD)).toBe(false);
    expect(graphOf(args(meta({ width: 1080, height: 1080 })))).toContain("gblur");
  });
});

describe("10. ultra-wide 2560×1080 — blurred-fill", () => {
  it("non-16:9 → blurred-fill", () => {
    expect(isEffectively169(meta({ width: 2560, height: 1080 }), STANDARD)).toBe(false);
    expect(graphOf(args(meta({ width: 2560, height: 1080 })))).toContain("gblur");
  });
});

describe("11. no audio — no audio args, no silent track", () => {
  it("-an, no -c:a, no -map 0:a; drop_audio transformation; expected audioCodec null", () => {
    const m = meta({ audioCodec: null });
    const a = args(m);
    expect(a).toContain("-an");
    expect(hasSeq(a, ["-c:a", "aac"])).toBe(false);
    expect(hasSeq(a, ["-map", "0:a:0"])).toBe(false);
    expect(a).not.toContain("anullsrc");
    expect(buildTransformations(m, STANDARD)).toContainEqual({ kind: "drop_audio" });
    expect(planVideoPreparation(m, STANDARD, VIDEO_SOURCE_LIMITS, REFS).expectedOutput.audioCodec).toBeNull();
  });
});

describe("12. multiple audio streams — deterministic single-track selection", () => {
  it("maps ONLY 0:a:0 (first stream) and one -c:a, never all audio", () => {
    const a = args(meta()); // hasAudio
    expect(hasSeq(a, ["-map", "0:a:0"])).toBe(true);
    // exactly one audio map + one audio codec directive
    expect(a.filter((t) => t === "0:a:0").length).toBe(1);
    expect(a.filter((t) => t === "-c:a").length).toBe(1);
    expect(hasSeq(a, ["-map", "0:a"])).toBe(false); // never the whole audio set
  });
});

describe("13/14. fps normalization for varied input rates", () => {
  it("60 → 30", () => {
    expect(graphOf(args(meta({ fps: 60 })))).toContain("fps=30");
    expect(buildTransformations(meta({ fps: 60 }), STANDARD)).toContainEqual({ kind: "fps", from: 60, to: 30 });
  });
  it("23.976 → 30 (recorded with rounded input rate)", () => {
    const t = buildTransformations(meta({ fps: 23.976 }), STANDARD);
    expect(t).toContainEqual({ kind: "fps", from: 23.976, to: 30 });
  });
  it("already-30 emits the fps filter but records no fps transformation", () => {
    expect(graphOf(args(meta({ fps: 30 })))).toContain("fps=30");
    expect(buildTransformations(meta({ fps: 30 }), STANDARD).some((t) => t.kind === "fps")).toBe(false);
  });
});

describe("15/16/17. out-of-limits inputs are rejected with the specific code", () => {
  it("duration → VIDEO_DURATION_EXCEEDED", () => {
    expect(() => planVideoPreparation(meta({ durationSeconds: 120 }), STANDARD, VIDEO_SOURCE_LIMITS, REFS)).toThrow(VideoPreparationError);
    try {
      planVideoPreparation(meta({ durationSeconds: 120 }), STANDARD, VIDEO_SOURCE_LIMITS, REFS);
    } catch (e) {
      expect((e as VideoPreparationError).code).toBe("VIDEO_DURATION_EXCEEDED");
    }
  });
  it("codec → VIDEO_CODEC_UNSUPPORTED", () => {
    try {
      planVideoPreparation(meta({ videoCodec: "hevc" }), STANDARD, VIDEO_SOURCE_LIMITS, REFS);
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationError).code).toBe("VIDEO_CODEC_UNSUPPORTED");
    }
  });
  it("container → VIDEO_CONTAINER_UNSUPPORTED", () => {
    try {
      planVideoPreparation(meta({ container: "matroska,webm" }), STANDARD, VIDEO_SOURCE_LIMITS, REFS);
      throw new Error("should throw");
    } catch (e) {
      expect((e as VideoPreparationError).code).toBe("VIDEO_CONTAINER_UNSUPPORTED");
    }
  });
});

describe("18/19. fingerprint invariants", () => {
  it("18. stable for equivalent input — same fingerprint even with DIFFERENT refs", () => {
    const a = planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, { sourceRef: "s-A.mp4", normalizedRef: "p-A.mp4" });
    const b = planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, { sourceRef: "s-B.mp4", normalizedRef: "p-B.mp4" });
    expect(a.preparationFingerprint).toBe(b.preparationFingerprint);
    // but the executable args DO differ (operational refs spliced in)
    expect(a.ffmpegArgs).not.toEqual(b.ffmpegArgs);
    expect(a.ffmpegArgs).toContain("s-A.mp4");
  });
  it("19. differs on material change (metadata, rotation, profile)", () => {
    const base = planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, REFS).preparationFingerprint;
    const diffDims = planVideoPreparation(meta({ width: 1080, height: 1920 }), STANDARD, VIDEO_SOURCE_LIMITS, REFS).preparationFingerprint;
    const diffRot = planVideoPreparation(meta({ rotationDegrees: 90 }), STANDARD, VIDEO_SOURCE_LIMITS, REFS).preparationFingerprint;
    const altProfile: RenderProfileSpec = { ...STANDARD, id: "standard", width: 1280, height: 720 };
    const diffProfile = planVideoPreparation(meta(), altProfile, VIDEO_SOURCE_LIMITS, REFS).preparationFingerprint;
    expect(new Set([base, diffDims, diffRot, diffProfile]).size).toBe(4);
  });
  it("fingerprint is schema-versioned + hex", () => {
    expect(planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, REFS).preparationFingerprint).toMatch(/^2:[0-9a-f]{64}$/);
  });
});

// --- validatePreparedMetadata (probe includes pixelFormat) ---
function probe(overrides: Partial<PreparedVideoProbe> = {}): PreparedVideoProbe {
  return {
    container: "mov,mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 36,
    bytes: 10 * 1024 * 1024,
    rotationDegrees: 0,
    pixelFormat: "yuv420p",
    colorRange: "tv",
    ...overrides,
  };
}

describe("20-24. validatePreparedMetadata", () => {
  it("20. valid prepared output passes", () => {
    const r = validatePreparedMetadata(probe(), STANDARD, { audioExpected: true });
    expect(r.ok).toBe(true);
    expect(r.code).toBeNull();
    expect(r.violations).toEqual([]);
  });
  it("21. invalid by dimensions → VIDEO_PREPARED_SOURCE_INVALID", () => {
    const r = validatePreparedMetadata(probe({ width: 1280, height: 720 }), STANDARD);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("VIDEO_PREPARED_SOURCE_INVALID");
    expect(r.violations.map((v) => v.check)).toContain("dimensions");
  });
  it("22. invalid by video codec", () => {
    const r = validatePreparedMetadata(probe({ videoCodec: "hevc" }), STANDARD);
    expect(r.code).toBe("VIDEO_PREPARED_SOURCE_INVALID");
    expect(r.violations.map((v) => v.check)).toContain("video_codec");
  });
  it("23. invalid by fps", () => {
    const r = validatePreparedMetadata(probe({ fps: 25 }), STANDARD);
    expect(r.violations.map((v) => v.check)).toContain("fps");
  });
  it("24. residual rotation is rejected", () => {
    const r = validatePreparedMetadata(probe({ rotationDegrees: 90 }), STANDARD);
    expect(r.violations.map((v) => v.check)).toContain("residual_rotation");
  });
  it("pixel format other than yuv420p is rejected", () => {
    expect(validatePreparedMetadata(probe({ pixelFormat: "yuv444p" }), STANDARD).violations.map((v) => v.check)).toContain("pixel_format");
  });
  it("audio expectation: expected-none but audio present is rejected; expected-aac but none is rejected", () => {
    expect(validatePreparedMetadata(probe({ audioCodec: "aac" }), STANDARD, { audioExpected: false }).violations.map((v) => v.check)).toContain("audio");
    expect(validatePreparedMetadata(probe({ audioCodec: null }), STANDARD, { audioExpected: true }).violations.map((v) => v.check)).toContain("audio");
  });
  it("no-audio prepared output with audioExpected:false passes", () => {
    expect(validatePreparedMetadata(probe({ audioCodec: null }), STANDARD, { audioExpected: false }).ok).toBe(true);
  });
});

// --- Gate 5A remediation: full-range sources must be VALUE-normalized to limited/TV ---
describe("color-range normalization (Gate 5A: yuvj420p/pc source)", () => {
  it("both filter graphs end in a REAL range-conversion pass, not a metadata retag", () => {
    const graph169 = graphOf([...planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, REFS).ffmpegArgs]);
    const graphBlur = graphOf([...planVideoPreparation(meta({ width: 1080, height: 1920 }), STANDARD, VIDEO_SOURCE_LIMITS, REFS).ffmpegArgs]);
    for (const g of [graph169, graphBlur]) {
      expect(g).toContain("scale=in_range=auto:out_range=tv,format=yuv420p");
      // the conversion pass must come AFTER the geometry/fps stages, right before format
      expect(g.indexOf("out_range=tv")).toBeGreaterThan(g.indexOf("fps="));
    }
  });
  it("encoder args tag the stream limited (-color_range tv) — coherent with converted values", () => {
    const args = [...planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, REFS).ffmpegArgs];
    const i = args.indexOf("-color_range");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("tv");
  });
  it("records the color_range transformation and expects a tv-range output", () => {
    const plan = planVideoPreparation(meta(), STANDARD, VIDEO_SOURCE_LIMITS, REFS);
    expect(plan.transformations).toContainEqual({ kind: "color_range", to: "tv" });
    expect(describeTransformations(plan.transformations)).toContain("color range → tv (limited)");
    expect(plan.expectedOutput.colorRange).toBe("tv");
  });
  it("validator: colorRange 'tv' passes; null (no VUI signal = limited per H.264) passes", () => {
    expect(validatePreparedMetadata(probe({ colorRange: "tv" }), STANDARD, { audioExpected: true }).ok).toBe(true);
    expect(validatePreparedMetadata(probe({ colorRange: null }), STANDARD, { audioExpected: true }).ok).toBe(true);
  });
  it("validator: colorRange 'pc' is rejected (fail-closed)", () => {
    const r = validatePreparedMetadata(probe({ colorRange: "pc" }), STANDARD);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("VIDEO_PREPARED_SOURCE_INVALID");
    expect(r.violations.map((v) => v.check)).toContain("color_range");
  });
  it("validator: unknown range values are rejected, never assumed limited", () => {
    expect(validatePreparedMetadata(probe({ colorRange: "unknown" }), STANDARD).violations.map((v) => v.check)).toContain("color_range");
  });
  it("validator: a yuvj420p prepared output is rejected on BOTH pixel_format and color_range", () => {
    const checks = validatePreparedMetadata(probe({ pixelFormat: "yuvj420p", colorRange: "pc" }), STANDARD).violations.map((v) => v.check);
    expect(checks).toContain("pixel_format");
    expect(checks).toContain("color_range");
  });
});

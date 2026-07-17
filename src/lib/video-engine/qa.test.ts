import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentTypeFromQa, parseFfprobe, runFfprobe, type ExpectedTechnicalSpec } from "@/lib/video-engine/qa";

// A captured ffprobe payload shape (ffprobe -print_format json -show_format
// -show_streams), matching what the P2.0 spike actually observed for a
// 1920x1080/30fps/h264 render (docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md).
function ffprobeFixture(overrides: {
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
  format_name?: string;
} = {}) {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: overrides.codec_name ?? "h264",
        width: overrides.width ?? 1920,
        height: overrides.height ?? 1080,
        r_frame_rate: overrides.r_frame_rate ?? "30/1",
        duration: overrides.duration ?? "13.056000",
      },
    ],
    format: {
      format_name: overrides.format_name ?? "mov,mp4,m4a,3gp,3g2,mj2",
      duration: overrides.duration ?? "13.056000",
      size: "1899428",
    },
  };
}

const EXPECTED: ExpectedTechnicalSpec = {
  container: "mp4",
  codec: "h264",
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 13.056,
  toleranceSec: 1,
};

const BYTES = Buffer.from("some rendered mp4 bytes for the test", "utf8");

describe("parseFfprobe", () => {
  it("passes on a valid mp4/h264/1920x1080/30fps/duration-in-tolerance payload", () => {
    const result = parseFfprobe(ffprobeFixture(), EXPECTED, BYTES);
    expect(result.ok).toBe(true);
    expect(result.container).toContain("mp4");
    expect(result.codec).toBe("h264");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.checks).toEqual({
      container: true,
      codec: true,
      width: true,
      height: true,
      fps: true,
      duration: true,
      bytesPositive: true,
      decodable: true,
    });
  });

  it("computes a real SHA-256 of the actual bytes (not a fabricated value)", () => {
    const result = parseFfprobe(ffprobeFixture(), EXPECTED, BYTES);
    const expectedSha = createHash("sha256").update(BYTES).digest("hex");
    expect(result.checksumSha256).toBe(expectedSha);
  });

  it("reports bytes as the real buffer length", () => {
    const result = parseFfprobe(ffprobeFixture(), EXPECTED, BYTES);
    expect(result.bytes).toBe(BYTES.length);
  });

  it("fails with the specific failing check — wrong codec", () => {
    const result = parseFfprobe(ffprobeFixture({ codec_name: "hevc" }), EXPECTED, BYTES);
    expect(result.ok).toBe(false);
    expect(result.checks.codec).toBe(false);
    expect(result.checks.container).toBe(true);
    expect(result.checks.width).toBe(true);
  });

  it("fails with the specific failing check — wrong resolution", () => {
    const result = parseFfprobe(ffprobeFixture({ width: 1280, height: 720 }), EXPECTED, BYTES);
    expect(result.ok).toBe(false);
    expect(result.checks.width).toBe(false);
    expect(result.checks.height).toBe(false);
    expect(result.checks.codec).toBe(true);
  });

  it("fails with the specific failing check — wrong fps", () => {
    const result = parseFfprobe(ffprobeFixture({ r_frame_rate: "24/1" }), EXPECTED, BYTES);
    expect(result.ok).toBe(false);
    expect(result.checks.fps).toBe(false);
  });

  it("fails with the specific failing check — duration out of tolerance", () => {
    const result = parseFfprobe(ffprobeFixture({ duration: "60.000000" }), EXPECTED, BYTES);
    expect(result.ok).toBe(false);
    expect(result.checks.duration).toBe(false);
  });

  it("fails with the specific failing check — wrong container", () => {
    const result = parseFfprobe(ffprobeFixture({ format_name: "matroska,webm" }), EXPECTED, BYTES);
    expect(result.ok).toBe(false);
    expect(result.checks.container).toBe(false);
  });

  it("fails bytesPositive on empty bytes", () => {
    const result = parseFfprobe(ffprobeFixture(), EXPECTED, Buffer.alloc(0));
    expect(result.ok).toBe(false);
    expect(result.checks.bytesPositive).toBe(false);
  });

  it("fails decodable when there is no video stream at all", () => {
    const result = parseFfprobe({ streams: [], format: { format_name: "mov,mp4" } }, EXPECTED, BYTES);
    expect(result.ok).toBe(false);
    expect(result.checks.decodable).toBe(false);
  });
});

describe("contentTypeFromQa", () => {
  it("returns video/mp4 for a QA result that confirms container=mp4 + codec=h264", () => {
    const qa = parseFfprobe(ffprobeFixture(), EXPECTED, BYTES);
    expect(qa.ok).toBe(true);
    expect(contentTypeFromQa(qa)).toBe("video/mp4");
  });

  it("throws (withholds a content-type) when the detected codec is not h264", () => {
    const qa = parseFfprobe(ffprobeFixture({ codec_name: "hevc" }), EXPECTED, BYTES);
    expect(() => contentTypeFromQa(qa)).toThrow();
  });

  it("throws (withholds a content-type) when the detected container is not mp4", () => {
    const qa = parseFfprobe(ffprobeFixture({ format_name: "matroska,webm" }), EXPECTED, BYTES);
    expect(() => contentTypeFromQa(qa)).toThrow();
  });
});

describe("runFfprobe", () => {
  it("runs `sh -c \"ffprobe …\"` and returns the parsed JSON on exit 0", async () => {
    const fixture = ffprobeFixture();
    const exec = {
      async runCommand(cmd: string, args: string[]) {
        expect(cmd).toBe("sh");
        expect(args[0]).toBe("-c");
        expect(args[1]).toContain("ffprobe");
        expect(args[1]).toContain("/tmp/out.mp4");
        return {
          exitCode: 0,
          async stdout() {
            return JSON.stringify(fixture);
          },
          async stderr() {
            return "";
          },
        };
      },
    };

    const json = await runFfprobe(exec, "/tmp/out.mp4");
    expect(json).toEqual(fixture);
  });

  it("throws (does not fabricate a result) when ffprobe exits non-zero", async () => {
    const exec = {
      async runCommand() {
        return {
          exitCode: 127,
          async stdout() {
            return "";
          },
          async stderr() {
            return "sh: ffprobe: command not found";
          },
        };
      },
    };

    await expect(runFfprobe(exec, "/tmp/out.mp4")).rejects.toThrow(/ffprobe failed/);
  });
});

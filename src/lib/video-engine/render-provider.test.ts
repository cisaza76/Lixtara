import { describe, expect, it } from "vitest";
import { FakeRenderProvider, FAKE_FFPROBE_JSON, type RenderInput } from "@/lib/video-engine/render-provider";
import { parseFfprobe, type ExpectedTechnicalSpec } from "@/lib/video-engine/qa";

function input(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    compositionId: "ListingVideo",
    templateVersion: "1",
    localAssetPaths: ["/tmp/a.jpg", "/tmp/b.jpg"],
    inputProps: { photos: [{ url: "/tmp/a.jpg" }, { url: "/tmp/b.jpg" }], badge: null },
    traceId: "trace-fake-1",
    ...overrides,
  };
}

describe("FakeRenderProvider", () => {
  it("returns a small fixed mp4 buffer + full RenderMediaOutput shape", async () => {
    const provider = new FakeRenderProvider();
    const out = await provider.render(input());

    expect(Buffer.isBuffer(out.bytes)).toBe(true);
    expect(out.bytes.length).toBeGreaterThan(0);
    expect(out.mime).toBe("video/mp4");
    expect(out.provider).toBe("vercel-sandbox");
    expect(out.renderer).toBe("remotion");
    expect(typeof out.bundleVersion).toBe("string");
    expect(typeof out.baseArtifactVersion).toBe("string");
  });

  it("returns separated stage metrics (not one total)", async () => {
    const provider = new FakeRenderProvider();
    const out = await provider.render(input());

    expect(typeof out.metrics.sandboxStartupMs).toBe("number");
    expect(typeof out.metrics.bundleMs).toBe("number");
    expect(typeof out.metrics.selectCompositionMs).toBe("number");
    expect(typeof out.metrics.renderMs).toBe("number");
  });

  it("records every call it receives — including badge:null pass-through", async () => {
    const provider = new FakeRenderProvider();
    const call = input({ inputProps: { badge: null, other: "x" } });
    await provider.render(call);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual(call);
    expect((provider.calls[0].inputProps as { badge: null }).badge).toBeNull();
  });

  it("is deterministic across repeated calls (byte-identical fixed buffer)", async () => {
    const provider = new FakeRenderProvider();
    const a = await provider.render(input());
    const b = await provider.render(input());
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });

  it("accepts overrides for tests that need specific output values", async () => {
    const provider = new FakeRenderProvider({ bundleVersion: "custom-bundle-v9" });
    const out = await provider.render(input());
    expect(out.bundleVersion).toBe("custom-bundle-v9");
  });

  // Requirement (fix): no host ffprobe dependency anywhere — QA parses whatever ffprobe
  // JSON the render provider reports (captured INSIDE the Sandbox for the real
  // provider), never a separately-spawned binary. The fixture's canned payload must
  // itself be a genuinely valid mp4/h264/1920x1080/30fps ffprobe result, so a test that
  // wires the REAL parseFfprobe-based QA against an unmodified FakeRenderProvider still
  // passes.
  it("returns a canned, VALID ffprobe JSON (mp4/h264/1920x1080/30fps) as `ffprobeJson`", async () => {
    const provider = new FakeRenderProvider();
    const out = await provider.render(input());

    expect(typeof out.ffprobeJson).toBe("string");
    expect(out.ffprobeJson).toBe(FAKE_FFPROBE_JSON);

    const expected: ExpectedTechnicalSpec = {
      container: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 13.5,
      toleranceSec: 2,
    };
    const qa = parseFfprobe(JSON.parse(out.ffprobeJson), expected, out.bytes);
    expect(qa.ok).toBe(true);
  });

  it("lets a test spoof a failing ffprobeJson via overrides (so QA fails before any upload/Asset)", async () => {
    const badFfprobeJson = JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, r_frame_rate: "30/1", duration: "13.5" }],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "13.5" },
    });
    const provider = new FakeRenderProvider({ ffprobeJson: badFfprobeJson });
    const out = await provider.render(input());

    const expected: ExpectedTechnicalSpec = {
      container: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 13.5,
      toleranceSec: 2,
    };
    const qa = parseFfprobe(JSON.parse(out.ffprobeJson), expected, out.bytes);
    expect(qa.ok).toBe(false);
    expect(qa.checks.codec).toBe(false);
  });
});

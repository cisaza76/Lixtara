// F4.2 — job-routing integration: buildRealProduce auto-selects the strategy per listing
// from Source Asset existence, and buildRealWorkerDeps gates it by CREATIVE_STUDIO_VIDEO_ENABLED.
// Exactly ONE strategy runs, ONE render, reusing the SAME F3 pipeline.
import { describe, it, expect, afterEach } from "vitest";
import type { Asset, AssetStore, NewAsset } from "@/lib/assets/types";
import { createFakeStoragePort } from "@/lib/video-engine/storage-port";
import { FakeRenderProvider } from "@/lib/video-engine/render-provider";
import type { SandboxCommandResult, VideoPreparationSandbox } from "@/lib/video-engine/execute-video-preparation";
import { buildRealProduce, buildRealWorkerDeps, defaultRunQa } from "@/lib/video-engine/worker-deps";
import type { SupabaseClient } from "@supabase/supabase-js";

const OWNER = "owner-1";
const LISTING = "listing-1";
const asset = (o: Partial<Asset>): Asset => ({
  id: "x", listingId: LISTING, ownerId: OWNER, kind: "photo", version: 1, parentAsset: null, sourceType: "property_photo",
  sourceId: null, provenance: { sourceAssetIds: [], capability: "photo", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "b", storagePath: "p", checksum: null, bytes: 1, mime: "", costUsd: 0, costProvider: null, createdBy: OWNER,
  lifecycle: "approved", qa: null, policy: null, createdAt: "2026-07-23T00:00:00Z", ...o,
});
const SOURCE_VIDEO = asset({ id: "srcv", kind: "video", sourceType: "seller_upload", sourceId: "u1", mime: "video/mp4", storageBucket: "creative-studio", storagePath: "source/o/l/srcv.mp4" });
const PHOTOS = [asset({ id: "ph1", sourceId: "p1", mime: "image/jpeg" }), asset({ id: "ph2", sourceId: "p2", mime: "image/jpeg" })];

const OUTPUT_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1", pix_fmt: "yuv420p" },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "8.0" },
});
function res(exitCode: number, stdout: string): SandboxCommandResult {
  return { exitCode, stdout: async () => stdout, stderr: async () => "" };
}
interface FakePrep extends VideoPreparationSandbox {
  ffmpegRenders: number;
}
function fakePrep(): FakePrep {
  let ffmpegRenders = 0;
  return {
    get ffmpegRenders() {
      return ffmpegRenders;
    },
    async writeFiles() {},
    async runCommand(command, args) {
      const a = [...args];
      if (a.includes("-version")) return res(0, `${command} version 8.1.2`);
      if (command === "ffmpeg") {
        ffmpegRenders += 1;
        return res(0, "");
      }
      if (command === "stat") return res(0, "123456");
      if (command === "ffprobe") return res(0, OUTPUT_PROBE);
      return res(0, "");
    },
    async readFileToBuffer() {
      return Buffer.from("PREPARED");
    },
    async stop() {},
  };
}
function store(seed: Asset[]): AssetStore & { rows: Asset[] } {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async insert(a: NewAsset) { const x: Asset = { ...a, id: `row-${++n}`, createdAt: "2026-07-23T01:00:00Z" }; rows.push(x); return x; },
    async findBySource(st, sid) { return rows.find((r) => r.sourceType === st && r.sourceId === sid) ?? null; },
    async listByListing(lid) { return rows.filter((r) => r.listingId === lid); },
    async getById(id) { return rows.find((r) => r.id === id) ?? null; },
  };
}

let clock = 0;
const now = () => (clock += 100);
const INPUT = { jobId: "job-1", listingId: LISTING, ownerId: OWNER, traceId: "tr" };
const HOOKS = { onStage: async () => {} };

function autoDeps(over: { hasSource: boolean; prep?: FakePrep; render?: FakeRenderProvider }) {
  const prep = over.prep ?? fakePrep();
  const render = over.render ?? new FakeRenderProvider();
  return {
    prep,
    render,
    resolved: {
      assets: store(over.hasSource ? [SOURCE_VIDEO, ...PHOTOS] : [...PHOTOS]),
      storage: createFakeStoragePort(),
      render,
      runQa: defaultRunQa,
      loadListing: async () => ({ addressLine: "1 A St", priceLabel: "$1" }),
      downloadAsset: async () => {},
      ensurePhotoAssets: async () => {},
      now,
      brandName: "Lixtara",
      ctaText: "cta",
      tempDirPrefix: "t-",
      // F4.2: no explicit strategy → auto-route.
      autoRouteStrategy: true,
      resolveVideoSource: async () => (over.hasSource ? SOURCE_VIDEO : null),
      createPrepSandbox: async () => prep,
      downloadSourceBytes: async () => Buffer.from("SRC"),
      prepTimeoutMs: 1000,
    },
  };
}

describe("F4.2 — auto-routing via buildRealProduce", () => {
  it("Listing WITH a Source Asset → uploaded_video (prep runs, render gets uploaded_video)", async () => {
    const { resolved, prep, render } = autoDeps({ hasSource: true });
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(prep.ffmpegRenders).toBe(1); // preparation ran
    expect(render.calls.length).toBe(1); // exactly ONE render (never double)
    expect((render.calls[0].inputProps as { source: string }).source).toBe("uploaded_video");
  });

  it("Listing WITHOUT a Source Asset → photo_slideshow (prep NEVER runs)", async () => {
    const { resolved, prep, render } = autoDeps({ hasSource: false });
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(prep.ffmpegRenders).toBe(0); // no preparation
    expect(render.calls.length).toBe(1); // exactly ONE render
    const props = render.calls[0].inputProps as { source?: string; photos?: unknown[] };
    expect(props.source).toBeUndefined(); // photo inputProps carry no `source`
    expect(Array.isArray(props.photos)).toBe(true);
  });

  it("an invalid Source Asset does NOT break the pipeline → falls back to photo_slideshow", async () => {
    const prep = fakePrep();
    const render = new FakeRenderProvider();
    const { resolved } = autoDeps({ hasSource: false, prep, render });
    // resolver returns a malformed video (no storage location) → not usable → photo path.
    resolved.resolveVideoSource = async () => ({ ...SOURCE_VIDEO, storagePath: "" });
    resolved.assets = store([...PHOTOS]);
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(prep.ffmpegRenders).toBe(0);
    expect(render.calls.length).toBe(1);
  });

  it("never runs both strategies (exactly one render per job)", async () => {
    for (const hasSource of [true, false]) {
      const { resolved, render } = autoDeps({ hasSource });
      await buildRealProduce(resolved)(INPUT, HOOKS);
      expect(render.calls.length).toBe(1);
    }
  });
});

describe("F4.2 — feature-flag gating via buildRealWorkerDeps", () => {
  const client = {} as unknown as SupabaseClient;
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  function overrides(prep: FakePrep) {
    return {
      assets: store([SOURCE_VIDEO, ...PHOTOS]),
      storage: createFakeStoragePort(),
      render: new FakeRenderProvider(),
      runQa: defaultRunQa,
      loadListing: async () => ({ addressLine: "1 A St", priceLabel: "$1" }),
      downloadAsset: async () => {},
      ensurePhotoAssets: async () => {},
      now,
      resolveVideoSource: async (): Promise<Asset | null> => SOURCE_VIDEO,
      createPrepSandbox: async () => prep,
      downloadSourceBytes: async () => Buffer.from("SRC"),
    };
  }

  it("flag OFF forces photo_slideshow even when a Source Asset exists", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    const prep = fakePrep();
    const { produce } = buildRealWorkerDeps(client, overrides(prep));
    await produce(INPUT, HOOKS);
    expect(prep.ffmpegRenders).toBe(0); // uploaded_video NOT chosen
  });

  it("flag ON auto-selects uploaded_video when a Source Asset exists", async () => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = "true";
    const prep = fakePrep();
    const { produce } = buildRealWorkerDeps(client, overrides(prep));
    await produce(INPUT, HOOKS);
    expect(prep.ffmpegRenders).toBe(1); // auto-routed to uploaded_video
  });

  it("flag ON auto-selects photo_slideshow when NO Source Asset exists", async () => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = "true";
    const prep = fakePrep();
    const o = overrides(prep);
    o.assets = store([...PHOTOS]);
    o.resolveVideoSource = async () => null;
    const { produce } = buildRealWorkerDeps(client, o);
    await produce(INPUT, HOOKS);
    expect(prep.ffmpegRenders).toBe(0); // photo path
  });
});

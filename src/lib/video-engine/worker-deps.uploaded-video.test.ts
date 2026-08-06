// F3-A Step 5 — integration tests for the uploaded_video pipeline branch (fakes only; no
// real Sandbox/Supabase/ffmpeg). Proves: one pipeline, strategy dispatch, preparation +
// render of the SAME composition, asset persistence, prepared clip NEVER persisted, cleanup
// on success and every failure, provenance, QA, feature-flag gating.
import { describe, it, expect, afterEach } from "vitest";
import type { Asset, AssetStore, NewAsset } from "@/lib/assets/types";
import { createFakeStoragePort, type FakeStoragePort } from "@/lib/video-engine/storage-port";
import { FakeRenderProvider } from "@/lib/video-engine/render-provider";
import { TEMPLATE_ID } from "@/lib/video-engine/versions";
import { buildRealProduce, buildRealWorkerDeps, defaultRunQa } from "@/lib/video-engine/worker-deps";
import { produceUploadedVideoStrategy } from "@/lib/video-engine/uploaded-video-pipeline";
import { VideoSourceMissingError } from "@/lib/video-engine/produce-asset";
import { FailureEvidenceCollector } from "@/lib/video-engine/failure-evidence";
import { VideoPreparationExecutionError } from "@/lib/video-engine/execute-video-preparation";
import { PREPARATION_PLAN_SCHEMA_VERSION, VideoPreparationError } from "@/lib/video-engine/prepare-video";
import type { SandboxCommandResult, VideoPreparationSandbox } from "@/lib/video-engine/execute-video-preparation";
import type { SupabaseClient } from "@supabase/supabase-js";

// --- fixtures ---
const SOURCE_VIDEO: Asset = {
  id: "src-video-1",
  listingId: "listing-1",
  ownerId: "owner-1",
  kind: "video",
  version: 1,
  parentAsset: null,
  sourceType: "seller_upload",
  sourceId: "upload-1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio",
  storagePath: "owner-1/listing-1/source/src-video-1.mp4",
  checksum: null,
  bytes: 20_000_000,
  mime: "video/mp4",
  costUsd: 0,
  costProvider: null,
  createdBy: "owner-1",
  lifecycle: "approved",
  qa: null,
  policy: null,
  createdAt: "2026-07-22T00:00:00.000Z",
};
const PHOTO_ASSET: Asset = { ...SOURCE_VIDEO, id: "photo-1", kind: "photo", sourceType: "property_photo", sourceId: "p1", storagePath: "owner-1/listing-1/p1.jpg", mime: "image/jpeg" };
const PHOTO_ASSET2: Asset = { ...PHOTO_ASSET, id: "photo-2", sourceId: "p2", storagePath: "owner-1/listing-1/p2.jpg" };
// 2 photos → expected render ~12.83s, within QA tolerance of the FakeRenderProvider's 13.5s.
const PHOTOS = [PHOTO_ASSET, PHOTO_ASSET2];

const SOURCE_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1", pix_fmt: "yuv420p" },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { format_name: "mov,mp4", duration: "8.0" },
});
// Prepared output: 1920x1080/30/h264/yuv420p/aac, duration 8 → total render 2.5+8+3 = 13.5s,
// which matches FakeRenderProvider's FAKE_FFPROBE_JSON duration (QA passes).
const OUTPUT_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1", pix_fmt: "yuv420p" },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "8.0" },
});

function res(exitCode: number, stdout: string, stderr = ""): SandboxCommandResult {
  return { exitCode, stdout: async () => stdout, stderr: async () => stderr };
}

interface FakePrep extends VideoPreparationSandbox {
  calls: { command: string; args: readonly string[] }[];
  stopped: number;
  readCount: number;
}
function fakePrep(cfg: { ffmpegExit?: number; ffmpegThrow?: Error; outputProbe?: string; preparedBytes?: Buffer } = {}): FakePrep {
  const calls: { command: string; args: readonly string[] }[] = [];
  let stopped = 0;
  let readCount = 0;
  return {
    calls,
    get stopped() {
      return stopped;
    },
    get readCount() {
      return readCount;
    },
    async writeFiles(f) {
      calls.push({ command: "writeFiles", args: f.map((x) => x.path) });
    },
    async runCommand(command, args) {
      calls.push({ command, args: [...args] });
      const a = [...args];
      if (a.includes("-version")) return res(0, `${command} version 8.1.2-fake`);
      if (command === "sh") return res(0, "");
      if (command === "ffmpeg") {
        if (cfg.ffmpegThrow) throw cfg.ffmpegThrow;
        return res(cfg.ffmpegExit ?? 0, "", cfg.ffmpegExit ? "boom" : "");
      }
      if (command === "stat") return res(0, "123456");
      if (command === "ffprobe") {
        const p = a[a.length - 1];
        return res(0, p.includes("source") ? SOURCE_PROBE : (cfg.outputProbe ?? OUTPUT_PROBE));
      }
      if (command === "rm") return res(0, "");
      return res(0, "");
    },
    async readFileToBuffer() {
      readCount += 1;
      return cfg.preparedBytes ?? Buffer.from("PREPARED-BYTES");
    },
    async stop() {
      stopped += 1;
    },
  };
}

function inMemoryAssetStore(seed: Asset[] = []): AssetStore & { rows: Asset[] } {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async insert(a: NewAsset) {
      const asset: Asset = { ...a, id: `asset-${++n}`, createdAt: "2026-07-22T01:00:00.000Z" };
      rows.push(asset);
      return asset;
    },
    async findBySource(st, sid) {
      return rows.find((r) => r.sourceType === st && r.sourceId === sid) ?? null;
    },
    async listByListing(lid) {
      return rows.filter((r) => r.listingId === lid);
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

let clock = 0;
const now = () => (clock += 100);

function uploadedResolved(over: { prep?: FakePrep; render?: FakeRenderProvider; storage?: FakeStoragePort; assets?: ReturnType<typeof inMemoryAssetStore>; resolveVideoSource?: () => Promise<Asset | null> } = {}) {
  const assets = over.assets ?? inMemoryAssetStore([SOURCE_VIDEO]);
  const storage = over.storage ?? createFakeStoragePort();
  const render = over.render ?? new FakeRenderProvider();
  const prep = over.prep ?? fakePrep();
  const resolved = {
    assets,
    storage,
    render,
    runQa: defaultRunQa,
    loadListing: async () => ({ addressLine: "482 Coral Way, FL", priceLabel: "$725,000" }),
    downloadAsset: async () => {},
    now,
    brandName: "Lixtara",
    ctaText: "See more at lixtara.com",
    tempDirPrefix: "t-",
    sourceStrategy: "uploaded_video" as const,
    resolveVideoSource: over.resolveVideoSource ?? (async () => SOURCE_VIDEO),
    createPrepSandbox: async () => prep,
    downloadSourceBytes: async () => Buffer.from("SOURCE-BYTES"),
    prepTimeoutMs: 1000,
  };
  return { resolved, assets, storage, render, prep };
}

const INPUT = { jobId: "job-1", listingId: "listing-1", ownerId: "owner-1", traceId: "trace-1" };
const HOOKS = { onStage: async () => {} };
const ffmpegRenders = (p: FakePrep) => p.calls.filter((c) => c.command === "ffmpeg" && !c.args.includes("-version"));

describe("Step 5 — uploaded_video pipeline branch", () => {
  it("2. executes preparation (ffmpeg runs in the prep sandbox)", async () => {
    const { resolved, prep } = uploadedResolved();
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(ffmpegRenders(prep).length).toBe(1);
  });

  it("3. renders the SAME 'ListingVideo' composition with an uploaded_video input", async () => {
    const { resolved, render } = uploadedResolved();
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(render.calls.length).toBe(1);
    expect(render.calls[0].compositionId).toBe(TEMPLATE_ID);
    expect(TEMPLATE_ID).toBe("ListingVideo");
    const props = render.calls[0].inputProps as { source: string; videoSrc: string };
    expect(props.source).toBe("uploaded_video");
    expect(props.videoSrc).toMatch(/prepared-0\.mp4$/); // the prepared HOST temp
    expect(render.calls[0].localAssetPaths).toEqual([props.videoSrc]);
  });

  it("4. persists the final video asset", async () => {
    const { resolved, assets } = uploadedResolved();
    const result = await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(result.outputAsset.kind).toBe("video");
    expect(result.outputAsset.sourceType).toBe("generated");
    expect(assets.rows.some((r) => r.id === result.outputAsset.id)).toBe(true);
  });

  it("5. NEVER persists the prepared clip — only the render output is uploaded", async () => {
    const { resolved, storage, prep } = uploadedResolved();
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(prep.readCount).toBeGreaterThanOrEqual(1); // prepared read to host temp
    expect(storage.uploaded.length).toBe(1);
    const uploaded = storage.uploaded[0].bytes.toString("utf8");
    expect(uploaded).not.toBe("PREPARED-BYTES"); // prepared clip is NOT what got stored
    expect(uploaded).toContain("FAKE-MP4-CONTENT"); // the render output is
  });

  it("6. cleanup always occurs on success (prep sandbox stopped + workspace removed)", async () => {
    const { resolved, prep } = uploadedResolved();
    await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(prep.stopped).toBe(1);
    expect(prep.calls.some((c) => c.command === "rm")).toBe(true);
  });

  it("9. records complete provenance on the asset", async () => {
    const { resolved } = uploadedResolved();
    const result = await buildRealProduce(resolved)(INPUT, HOOKS);
    const prov = result.outputAsset.provenance as unknown as Record<string, unknown>;
    expect(prov.sourceStrategy).toBe("uploaded_video");
    expect(prov.renderProfile).toBe("standard");
    expect(prov.preparationFingerprint).toMatch(new RegExp(`^${PREPARATION_PLAN_SCHEMA_VERSION}:[0-9a-f]{64}$`));
    expect(prov.sourceHash).toEqual(expect.any(String));
    expect(prov.ffmpegVersion).toContain("8.1.2-fake");
    expect(prov.preparationMs).toEqual(expect.any(Number));
    expect(prov.outputHash).toEqual(expect.any(String));
    expect(prov.renderProvider).toBe("vercel-sandbox");
    expect(prov.rendererVersion).toBe("4.0.489");
  });

  it("10. runs the existing QA on the produced output", async () => {
    const { resolved } = uploadedResolved();
    const result = await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(result.technicalQa.ok).toBe(true);
    expect(result.technicalQa.checks.codec).toBe(true);
    expect(result.technicalQa.width).toBe(1920);
  });

  it("11. rollback if render fails — no asset, cleanup still runs", async () => {
    const failRender = new FakeRenderProvider();
    failRender.render = async () => {
      throw new Error("render boom");
    };
    const { resolved, assets, prep, storage } = uploadedResolved({ render: failRender });
    await expect(buildRealProduce(resolved)(INPUT, HOOKS)).rejects.toThrow(/render boom/);
    expect(assets.rows.some((r) => r.sourceType === "generated")).toBe(false);
    expect(storage.uploaded.length).toBe(0);
    expect(prep.stopped).toBe(1);
  });

  it("12. rollback if preparation fails — no asset, no render, cleanup runs", async () => {
    const { resolved, assets, render, prep } = uploadedResolved({ prep: fakePrep({ ffmpegExit: 1 }) });
    await expect(buildRealProduce(resolved)(INPUT, HOOKS)).rejects.toThrow();
    expect(assets.rows.some((r) => r.sourceType === "generated")).toBe(false);
    expect(render.calls.length).toBe(0); // never reached the render
    expect(prep.stopped).toBe(1);
  });

  it("13. rollback if storage fails — no asset, cleanup runs", async () => {
    const { resolved, assets, prep } = uploadedResolved({ storage: createFakeStoragePort({ failUpload: true }) });
    await expect(buildRealProduce(resolved)(INPUT, HOOKS)).rejects.toThrow();
    expect(assets.rows.some((r) => r.sourceType === "generated")).toBe(false);
    expect(prep.stopped).toBe(1);
  });

  it("14. cleanup on missing source (fail fast)", async () => {
    const { resolved, assets } = uploadedResolved({ resolveVideoSource: async () => null });
    await expect(buildRealProduce(resolved)(INPUT, HOOKS)).rejects.toThrow(/no uploaded source video/);
    expect(assets.rows.some((r) => r.sourceType === "generated")).toBe(false);
  });

  it("1. photo_slideshow path is unchanged when sourceStrategy is not uploaded_video", async () => {
    // sourceStrategy omitted → photo path. Seed a photo asset; the prep sandbox is never touched.
    const assets = inMemoryAssetStore(PHOTOS);
    const prep = fakePrep();
    const resolved = {
      ...uploadedResolved({ assets, prep }).resolved,
      sourceStrategy: undefined,
      ensurePhotoAssets: async () => {},
    };
    const result = await buildRealProduce(resolved)(INPUT, HOOKS);
    expect(result.outputAsset.kind).toBe("video");
    expect(ffmpegRenders(prep).length).toBe(0); // preparation never ran
    const prov = result.outputAsset.provenance as unknown as Record<string, unknown>;
    expect(prov.sourceStrategy).toBe("photo_slideshow");
    expect(prov.preparationFingerprint).toBeNull();
  });
});

describe("Step 5 — feature flag gating (buildRealWorkerDeps)", () => {
  const client = {} as unknown as SupabaseClient;
  const commonOverrides = () => {
    const prep = fakePrep();
    return {
      prep,
      overrides: {
        assets: inMemoryAssetStore([SOURCE_VIDEO, ...PHOTOS]),
        storage: createFakeStoragePort(),
        render: new FakeRenderProvider(),
        runQa: defaultRunQa,
        loadListing: async () => ({ addressLine: "1 A St", priceLabel: "$1" }),
        downloadAsset: async () => {},
        ensurePhotoAssets: async () => {},
        now,
        resolveVideoSource: async () => SOURCE_VIDEO,
        createPrepSandbox: async () => prep,
        downloadSourceBytes: async () => Buffer.from("SRC"),
      },
    };
  };

  afterEach(() => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
  });

  it("7. flag OFF forces photo_slideshow even with sourceStrategy override (identical behavior)", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    const { prep, overrides } = commonOverrides();
    const { produce } = buildRealWorkerDeps(client, { ...overrides, sourceStrategy: "uploaded_video" });
    await produce(INPUT, HOOKS);
    expect(ffmpegRenders(prep).length).toBe(0); // uploaded_video path NOT taken
  });

  it("8. flag ON enables uploaded_video", async () => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = "true";
    const { prep, overrides } = commonOverrides();
    const { produce } = buildRealWorkerDeps(client, { ...overrides, sourceStrategy: "uploaded_video" });
    await produce(INPUT, HOOKS);
    expect(ffmpegRenders(prep).length).toBe(1); // uploaded_video path taken
  });
});

// ---- Issue #112 — evidence + typed source-missing + preparing stage -----------------

describe("#112 — uploaded_video observability wiring", () => {
  it("throws typed VideoSourceMissingError when the listing has no uploaded source", async () => {
    const { resolved } = uploadedResolved({ resolveVideoSource: async () => null });
    await expect(
      produceUploadedVideoStrategy(INPUT, HOOKS, resolved, { addressLine: "x", priceLabel: "$1" }),
    ).rejects.toBeInstanceOf(VideoSourceMissingError);
  });

  it("announces onStage('preparing') BEFORE any prep-sandbox work", async () => {
    const { resolved, prep } = uploadedResolved();
    const stages: string[] = [];
    let firstPrepCallSeenAtStageCount = -1;
    const origRun = prep.runCommand.bind(prep);
    prep.runCommand = async (c, a, o) => {
      if (firstPrepCallSeenAtStageCount === -1) firstPrepCallSeenAtStageCount = stages.length;
      return origRun(c, a, o);
    };
    await produceUploadedVideoStrategy(
      INPUT,
      { onStage: async (s) => void stages.push(s) },
      resolved,
      { addressLine: "x", priceLabel: "$1" },
    );
    expect(stages[0]).toBe("preparing");
    expect(firstPrepCallSeenAtStageCount).toBeGreaterThanOrEqual(1); // preparing announced first
  });

  it("records sourceAssetId + preparation facts into hooks.evidence", async () => {
    const { resolved } = uploadedResolved();
    const evidence = new FailureEvidenceCollector(now);
    await produceUploadedVideoStrategy(
      INPUT,
      { onStage: async () => {}, evidence },
      { ...resolved, snapshotId: "snap_evidence" },
      { addressLine: "x", priceLabel: "$1" },
    );
    const s = evidence.snapshot();
    expect(s.sourceAssetId).toBe("src-video-1");
    expect(s.preparation).toMatchObject({ executed: true, snapshotId: "snap_evidence" });
    expect(typeof s.preparation?.fingerprint).toBe("string");
  });

  it("a prep ffmpeg failure leaves executed:true + kind + exitCode extractable via the typed error", async () => {
    const { resolved } = uploadedResolved({ prep: fakePrep({ ffmpegExit: 187 }) });
    const evidence = new FailureEvidenceCollector(now);
    let thrown: unknown;
    try {
      await produceUploadedVideoStrategy(INPUT, { onStage: async () => {}, evidence }, resolved, {
        addressLine: "x",
        priceLabel: "$1",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(VideoPreparationExecutionError);
    expect((thrown as VideoPreparationExecutionError).detail?.exitCode).toBe(187);
    expect(evidence.snapshot().preparation?.executed).toBe(true);
  });
});

describe("#112 — source ffprobe failure carries the probe's stderr (the fatal line)", () => {
  it("includes ffprobe stderr tail in the thrown message", async () => {
    const prep = fakePrep();
    const orig = prep.runCommand.bind(prep);
    prep.runCommand = async (c, a, o) => {
      if (c === "ffprobe" && [...a].some((x) => String(x).includes("source"))) {
        return { exitCode: 1, stdout: async () => "", stderr: async () => "moov atom not found\nInvalid data found when processing input" };
      }
      return orig(c, a, o);
    };
    const { resolved } = uploadedResolved({ prep });
    const err = await produceUploadedVideoStrategy(INPUT, HOOKS, resolved, { addressLine: "x", priceLabel: "$1" }).catch((e) => e);
    expect(String(err.message)).toContain("source ffprobe failed (exit 1)");
    expect(String(err.message)).toContain("moov atom not found");
  });
});

describe("UX 5C — an unreadable source classifies as VIDEO_CORRUPT (seller-actionable)", () => {
  it("source ffprobe failure throws typed VideoPreparationError with VIDEO_CORRUPT", async () => {
    const prep = fakePrep();
    const orig = prep.runCommand.bind(prep);
    prep.runCommand = async (c, a, o) => {
      if (c === "ffprobe" && [...a].some((x) => String(x).includes("source"))) {
        return { exitCode: 1, stdout: async () => "", stderr: async () => "moov atom not found" };
      }
      return orig(c, a, o);
    };
    const { resolved } = uploadedResolved({ prep });
    const err = await produceUploadedVideoStrategy(INPUT, HOOKS, resolved, { addressLine: "x", priceLabel: "$1" }).catch((e) => e);
    expect(err).toBeInstanceOf(VideoPreparationError);
    expect((err as VideoPreparationError).code).toBe("VIDEO_CORRUPT");
    expect(String(err.message)).toContain("moov atom not found");
  });
});

// ---- Etapa 1 — integración: MOV/H.264 SDR pasa; HEVC y HDR se rechazan tipados --------
describe("Etapa 1 — el pipeline con el archivo real (MOV/H.264 SDR)", () => {
  // Probe equivalente a IMG_6371.MOV del owner (iPhone 16 Pro).
  const iphoneProbe = (over: Record<string, unknown> = {}) => JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        r_frame_rate: "30000/1001",
        pix_fmt: "yuv420p",
        color_range: "tv",
        color_transfer: "bt709",
        color_primaries: "bt709",
        color_space: "bt709",
        ...over,
      },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "26.12" },
  });
  const IPHONE_SOURCE_PROBE = iphoneProbe();

  function prepWithSource(sourceProbe: string): FakePrep {
    const prep = fakePrep();
    const orig = prep.runCommand.bind(prep);
    prep.runCommand = async (c, a, o) => {
      if (c === "ffprobe" && [...a].some((x) => String(x).includes("source"))) {
        return { exitCode: 0, stdout: async () => sourceProbe, stderr: async () => "" };
      }
      return orig(c, a, o);
    };
    return prep;
  }

  it("MOV/H.264 SDR se prepara y renderiza (ffmpeg corre una vez)", async () => {
    const prep = prepWithSource(IPHONE_SOURCE_PROBE);
    const { resolved, render } = uploadedResolved({ prep });
    await produceUploadedVideoStrategy(INPUT, HOOKS, resolved, { addressLine: "x", priceLabel: "$1" });
    expect(ffmpegRenders(prep).length).toBe(1);
    expect((render.calls[0].inputProps as { source: string }).source).toBe("uploaded_video");
  });

  it("HEVC todavía se rechaza con VIDEO_CODEC_UNSUPPORTED (Etapa 2 pendiente)", async () => {
    const prep = prepWithSource(iphoneProbe({ codec_name: "hevc" }));
    const { resolved } = uploadedResolved({ prep });
    const err = await produceUploadedVideoStrategy(INPUT, HOOKS, resolved, { addressLine: "x", priceLabel: "$1" }).catch((e) => e);
    expect(err).toBeInstanceOf(VideoPreparationError);
    expect((err as VideoPreparationError).code).toBe("VIDEO_CODEC_UNSUPPORTED");
  });

  it("HDR (HLG) se rechaza fail-closed con VIDEO_HDR_UNSUPPORTED, sin tone-mapping ni retag", async () => {
    const prep = prepWithSource(iphoneProbe({ color_transfer: "arib-std-b67" }));
    const { resolved } = uploadedResolved({ prep });
    const err = await produceUploadedVideoStrategy(INPUT, HOOKS, resolved, { addressLine: "x", priceLabel: "$1" }).catch((e) => e);
    expect((err as VideoPreparationError).code).toBe("VIDEO_HDR_UNSUPPORTED");
    expect(ffmpegRenders(prep).length).toBe(0); // ni siquiera intenta preparar
  });
});

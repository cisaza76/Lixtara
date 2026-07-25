import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset, AssetStore, NewAsset } from "@/lib/assets/types";
import {
  produceVideoAsset,
  AssetDownloadFailedError,
  AssetPersistFailedError,
  RenderQaFailedError,
  StorageUploadFailedError,
  StorageVerifyFailedError,
  type AssetVideoProvenance,
  type ProduceVideoAssetDeps,
} from "@/lib/video-engine/produce-asset";
import { FAKE_FFPROBE_JSON, type RenderInput, type RenderMediaOutput, type RenderProvider } from "@/lib/video-engine/render-provider";
import { parseFfprobe, type TechnicalQaResult } from "@/lib/video-engine/qa";
import { createFakeStoragePort, type StoragePort } from "@/lib/video-engine/storage-port";

// ---- fixtures --------------------------------------------------------------

function photoAsset(id: string): Asset {
  return {
    id,
    listingId: "listing-1",
    ownerId: "owner-1",
    kind: "photo",
    version: 1,
    parentAsset: null,
    sourceType: "property_photo",
    sourceId: id,
    provenance: {
      sourceAssetIds: [],
      capability: "photo",
      engine: "asset-manager",
      provider: "seller_upload",
      prompt: null,
    },
    storageBucket: "property-photos",
    storagePath: `listing-1/${id}.jpg`,
    checksum: null,
    bytes: 1000,
    mime: "image/jpeg",
    costUsd: 0,
    costProvider: null,
    createdBy: "owner-1",
    lifecycle: "approved",
    qa: null,
    policy: null,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

function fakeAssetStore(opts: { failInsert?: boolean } = {}): AssetStore & { rows: Asset[] } {
  const rows: Asset[] = [];
  return {
    rows,
    async insert(a: NewAsset) {
      if (opts.failInsert) throw new Error("fake assets store: insert failed");
      const row = { ...a, id: `video-asset-1`, createdAt: "2026-07-15T00:01:00.000Z" } as Asset;
      rows.push(row);
      return row;
    },
    async findBySource() {
      return null;
    },
    async listByListing() {
      return rows;
    },
    async getById(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

function okRenderOutput(overrides: Partial<RenderMediaOutput> = {}): RenderMediaOutput {
  return {
    bytes: Buffer.from("FAKE-MP4-BYTES", "utf8"),
    mime: "video/mp4",
    provider: "vercel-sandbox",
    renderer: "remotion",
    bundleVersion: "bundle-v1",
    baseArtifactVersion: "base-v1",
    metrics: { sandboxStartupMs: 10, bundleMs: 5, selectCompositionMs: 2, renderMs: 100 },
    ffprobeJson: FAKE_FFPROBE_JSON,
    ...overrides,
  };
}

// A captured ffprobe payload (ffprobe -print_format json -show_format -show_streams),
// serialized to a string the way `RenderMediaOutput.ffprobeJson` carries it — for the
// "no host ffprobe" tests below, which exercise the REAL `parseFfprobe`-based QA path
// instead of `buildDeps()`'s injected canned `runQa`.
function ffprobeJsonFixture(overrides: { codec_name?: string; duration?: string } = {}): string {
  return JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: overrides.codec_name ?? "h264",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
        duration: overrides.duration ?? "13.500000",
      },
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: overrides.duration ?? "13.500000",
    },
  });
}

function okQaResult(overrides: Partial<TechnicalQaResult> = {}): TechnicalQaResult {
  return {
    ok: true,
    container: "mp4",
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: "30/1",
    durationSec: 6.5,
    bytes: 14,
    checksumSha256: "irrelevant-fake-checksum-from-qa",
    checks: {
      container: true,
      codec: true,
      width: true,
      height: true,
      fps: true,
      duration: true,
      bytesPositive: true,
      decodable: true,
    },
    ...overrides,
  };
}

const INPUT_PROPS = {
  property: { addressLine: "123 Ocean Dr" },
  priceLabel: "$799,000",
  photos: [{ url: "/tmp/local/photo-1.jpg" }, { url: "/tmp/local/photo-2.jpg" }],
  brand: { name: "Lixtara" },
  cta: { text: "Schedule a Tour" },
  badge: null,
};

const SOURCE_ASSETS = [photoAsset("photo-1"), photoAsset("photo-2")];
const LOCAL_PATHS = ["/tmp/local/photo-1.jpg", "/tmp/local/photo-2.jpg"];

let counter = 0;
function now(): number {
  counter += 10;
  return counter;
}

// ---- deps builders -----------------------------------------------------------

interface DepsBuild {
  deps: ProduceVideoAssetDeps;
  order: string[];
  renderCalls: RenderInput[];
  storage: ReturnType<typeof createFakeStoragePort>;
  assetsStore: AssetStore & { rows: Asset[] };
}

function buildDeps(opts: {
  renderOutput?: RenderMediaOutput;
  qaResult?: TechnicalQaResult;
  failUpload?: boolean;
  failReadVerify?: boolean;
  failInsert?: boolean;
  failRemove?: boolean;
} = {}): DepsBuild {
  const order: string[] = [];
  const renderCalls: RenderInput[] = [];
  const assetsStore = fakeAssetStore({ failInsert: opts.failInsert });
  const rawStorage = createFakeStoragePort({
    failUpload: opts.failUpload,
    failReadVerify: opts.failReadVerify,
    failRemove: opts.failRemove,
  });

  const render: RenderProvider = {
    async render(input: RenderInput) {
      order.push("render");
      renderCalls.push(input);
      return opts.renderOutput ?? okRenderOutput();
    },
  };

  const storage: StoragePort = {
    async upload(p, b, c) {
      order.push("upload");
      return rawStorage.upload(p, b, c);
    },
    async readVerify(b, p) {
      order.push("readVerify");
      return rawStorage.readVerify(b, p);
    },
    async remove(b, p) {
      order.push("remove");
      return rawStorage.remove(b, p);
    },
  };

  const assets: AssetStore = {
    async insert(a) {
      order.push("createAsset");
      return assetsStore.insert(a);
    },
    findBySource: assetsStore.findBySource,
    listByListing: assetsStore.listByListing,
    getById: assetsStore.getById,
  };

  const deps: ProduceVideoAssetDeps = {
    render,
    async runQa(ffprobeJson, bytes, _expected) {
      order.push("qa");
      expect(typeof ffprobeJson).toBe("string");
      expect(Buffer.isBuffer(bytes)).toBe(true);
      return opts.qaResult ?? okQaResult();
    },
    storage,
    assets,
    async downloadAssets(sourceAssets) {
      expect(sourceAssets).toEqual(SOURCE_ASSETS);
      return LOCAL_PATHS;
    },
    now,
  };

  return { deps, order, renderCalls, storage: rawStorage, assetsStore };
}

function baseInput() {
  return {
    listingId: "listing-1",
    ownerId: "owner-1",
    sourceAssets: SOURCE_ASSETS,
    inputProps: INPUT_PROPS,
    traceId: "trace-abc",
  };
}

// ---- tests ---------------------------------------------------------------

describe("produceVideoAsset — happy path", () => {
  it("returns a RenderResult { outputAsset, technicalQa, metrics, provenance }", async () => {
    const { deps } = buildDeps();
    const result = await produceVideoAsset(baseInput(), deps);

    expect(result.outputAsset).toBeDefined();
    expect(result.outputAsset.kind).toBe("video");
    expect(result.technicalQa.ok).toBe(true);
    expect(result.metrics).toBeDefined();
    expect(result.provenance).toBeDefined();
  });

  it("downloads source Assets to local paths and renders from those local paths (requirement 3)", async () => {
    const { deps, renderCalls } = buildDeps();
    await produceVideoAsset(baseInput(), deps);

    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0].localAssetPaths).toEqual(LOCAL_PATHS);
  });

  it("passes badge:null through to the render input unchanged (requirement 10)", async () => {
    const { deps, renderCalls } = buildDeps();
    await produceVideoAsset(baseInput(), deps);

    expect((renderCalls[0].inputProps as { badge: null }).badge).toBeNull();
  });

  it("sets full provenance (all 8 fields) on RenderResult.provenance", async () => {
    const { deps } = buildDeps();
    const result = await produceVideoAsset(baseInput(), deps);

    expect(result.provenance).toEqual({
      sourceAssetIds: ["photo-1", "photo-2"],
      templateId: "ListingVideo",
      templateVersion: "2",
      bundleVersion: "bundle-v1",
      inputSchemaVersion: "1",
      rendererVersion: "4.0.489",
      renderProvider: "vercel-sandbox",
      traceId: "trace-abc",
    });
  });

  it("sets full provenance (all 8 fields) on the created Asset's provenance column too", async () => {
    const { deps } = buildDeps();
    const result = await produceVideoAsset(baseInput(), deps);
    const assetProvenance = result.outputAsset.provenance as unknown as AssetVideoProvenance;

    expect(assetProvenance.sourceAssetIds).toEqual(["photo-1", "photo-2"]);
    expect(assetProvenance.templateId).toBe("ListingVideo");
    expect(assetProvenance.templateVersion).toBe("2");
    expect(assetProvenance.bundleVersion).toBe("bundle-v1");
    expect(assetProvenance.inputSchemaVersion).toBe("1");
    expect(assetProvenance.rendererVersion).toBe("4.0.489");
    expect(assetProvenance.renderProvider).toBe("vercel-sandbox");
    expect(assetProvenance.traceId).toBe("trace-abc");
  });

  it("sets a real SHA-256 of the actual rendered bytes as the Asset's checksum", async () => {
    const { deps } = buildDeps();
    const result = await produceVideoAsset(baseInput(), deps);

    const expectedSha = (await import("node:crypto"))
      .createHash("sha256")
      .update(Buffer.from("FAKE-MP4-BYTES", "utf8"))
      .digest("hex");
    expect(result.outputAsset.checksum).toBe(expectedSha);
  });

  it("returns separated metrics — all fields present (not one total)", async () => {
    const { deps } = buildDeps();
    const result = await produceVideoAsset(baseInput(), deps);

    const keys: (keyof typeof result.metrics)[] = [
      "sandboxStartupMs",
      "assetDownloadMs",
      "bundleMs",
      "selectCompositionMs",
      "renderMs",
      "qaMs",
      "uploadMs",
      "totalMs",
      "outputBytes",
      "estimatedCostUsd",
    ];
    for (const key of keys) {
      expect(typeof result.metrics[key]).toBe("number");
      expect(Number.isFinite(result.metrics[key])).toBe(true);
    }
    expect(result.metrics.outputBytes).toBeGreaterThan(0);
  });

  it("persists in the EXACT order: render -> QA -> upload -> readVerify -> createAsset", async () => {
    const { deps, order } = buildDeps();
    await produceVideoAsset(baseInput(), deps);

    expect(order).toEqual(["render", "qa", "upload", "readVerify", "createAsset"]);
  });
});

describe("produceVideoAsset — Storage content-type is derived from ffprobe, never the renderer's claimed mime", () => {
  it("uploads with the ffprobe-derived content-type even when the renderer's claimed mime is spoofed", async () => {
    // The RenderMediaOutput type pins `mime` to the "video/mp4" literal, but a real
    // (or malicious) renderer implementation is not type-checked at the call site —
    // this cast simulates a renderer that lies about its own output's mime.
    const spoofedRenderOutput = {
      ...okRenderOutput(),
      mime: "image/png",
    } as unknown as RenderMediaOutput;
    const { deps, storage } = buildDeps({ renderOutput: spoofedRenderOutput });

    await produceVideoAsset(baseInput(), deps);

    expect(storage.uploaded).toHaveLength(1);
    expect(storage.uploaded[0].contentType).toBe("video/mp4");
  });

  it("still short-circuits before any upload when QA fails, regardless of the renderer's claimed mime", async () => {
    const spoofedRenderOutput = {
      ...okRenderOutput(),
      mime: "image/png",
    } as unknown as RenderMediaOutput;
    const { deps, order, storage } = buildDeps({
      renderOutput: spoofedRenderOutput,
      qaResult: okQaResult({ ok: false, checks: { ...okQaResult().checks, codec: false } }),
    });

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(RenderQaFailedError);

    expect(order).toEqual(["render", "qa"]);
    expect(storage.uploaded).toHaveLength(0);
  });
});

describe("produceVideoAsset — QA parses the provider-supplied ffprobeJson (no host ffprobe spawn)", () => {
  // These tests wire up the REAL parseFfprobe-based runQa (mirrors worker-deps.ts's
  // `defaultRunQa`) instead of buildDeps()'s injected canned `runQa`, to prove QA
  // actually depends on what the render provider reports in `RenderMediaOutput
  // .ffprobeJson` — never a host-local ffprobe spawn.
  function buildDepsWithRealQa(renderOutput: RenderMediaOutput): DepsBuild {
    const built = buildDeps({ renderOutput });
    return {
      ...built,
      deps: {
        ...built.deps,
        async runQa(ffprobeJson, bytes, expected) {
          built.order.push("qa");
          return parseFfprobe(JSON.parse(ffprobeJson), expected, bytes);
        },
      },
    };
  }

  it("passes QA and creates the Asset when the provider's ffprobeJson matches the expected spec", async () => {
    const { deps, order, storage, assetsStore } = buildDepsWithRealQa(
      okRenderOutput({ ffprobeJson: ffprobeJsonFixture() }),
    );

    const result = await produceVideoAsset(baseInput(), deps);

    expect(result.technicalQa.ok).toBe(true);
    expect(result.technicalQa.checks).toEqual({
      container: true,
      codec: true,
      width: true,
      height: true,
      fps: true,
      duration: true,
      bytesPositive: true,
      decodable: true,
    });
    expect(order).toEqual(["render", "qa", "upload", "readVerify", "createAsset"]);
    expect(storage.uploaded).toHaveLength(1);
    expect(assetsStore.rows).toHaveLength(1);
  });

  it("fails QA before any upload/Asset when the provider's ffprobeJson reports a spoofed/wrong codec", async () => {
    const { deps, order, storage, assetsStore } = buildDepsWithRealQa(
      okRenderOutput({ ffprobeJson: ffprobeJsonFixture({ codec_name: "hevc" }) }),
    );

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(RenderQaFailedError);

    expect(order).toEqual(["render", "qa"]);
    expect(storage.uploaded).toHaveLength(0);
    expect(assetsStore.rows).toHaveLength(0);
  });

  it("fails QA before any upload/Asset when the provider's ffprobeJson reports a duration outside tolerance", async () => {
    const { deps, order, storage, assetsStore } = buildDepsWithRealQa(
      okRenderOutput({ ffprobeJson: ffprobeJsonFixture({ duration: "60.000000" }) }),
    );

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(RenderQaFailedError);

    expect(order).toEqual(["render", "qa"]);
    expect(storage.uploaded).toHaveLength(0);
    expect(assetsStore.rows).toHaveLength(0);
  });
});

describe("produceVideoAsset — QA failure", () => {
  it("throws RenderQaFailedError and creates NO upload, NO Asset", async () => {
    const { deps, order, storage, assetsStore } = buildDeps({
      qaResult: okQaResult({ ok: false, checks: { ...okQaResult().checks, codec: false } }),
    });

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(RenderQaFailedError);

    expect(order).toEqual(["render", "qa"]);
    expect(storage.uploaded).toHaveLength(0);
    expect(assetsStore.rows).toHaveLength(0);
  });
});

describe("produceVideoAsset — upload failure", () => {
  it("throws and creates NO Asset", async () => {
    const { deps, order, assetsStore } = buildDeps({ failUpload: true });

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(/upload failed/);

    expect(order).toEqual(["render", "qa", "upload"]);
    expect(assetsStore.rows).toHaveLength(0);
  });
});

describe("produceVideoAsset — read-verify failure", () => {
  it("cleans up the uploaded object and creates NO Asset", async () => {
    const { deps, order, storage, assetsStore } = buildDeps({ failReadVerify: true });

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(/read-verify/);

    expect(order).toEqual(["render", "qa", "upload", "readVerify", "remove"]);
    expect(storage.removed).toHaveLength(1);
    expect(assetsStore.rows).toHaveLength(0);
  });
});

describe("produceVideoAsset — orphan handling (upload OK, Asset creation fails)", () => {
  it("removes the uploaded object, then rethrows (never swallows the error)", async () => {
    const { deps, order, storage, assetsStore } = buildDeps({ failInsert: true });

    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(/insert failed/);

    expect(order).toEqual(["render", "qa", "upload", "readVerify", "createAsset", "remove"]);
    expect(storage.uploaded).toHaveLength(1);
    expect(storage.removed).toHaveLength(1);
    expect(storage.removed[0].path).toBe(storage.uploaded[0].path);
    expect(assetsStore.rows).toHaveLength(0);
  });

  it("propagates the ORIGINAL createAsset error even when orphan cleanup (remove) also fails", async () => {
    const { deps, order, storage, assetsStore } = buildDeps({ failInsert: true, failRemove: true });

    let caught: unknown;
    try {
      await produceVideoAsset(baseInput(), deps);
    } catch (err) {
      caught = err;
    }

    // The createAsset error ("insert failed"), not the remove error ("remove failed"),
    // must be what the caller sees — remove()'s own failure must not mask it.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/insert failed/);
    expect((caught as Error).message).not.toMatch(/remove failed/);

    // Orphan cleanup was still attempted, even though it failed.
    expect(order).toEqual(["render", "qa", "upload", "readVerify", "createAsset", "remove"]);
    expect(storage.uploaded).toHaveLength(1);
    expect(assetsStore.rows).toHaveLength(0);
  });
});

describe("produceVideoAsset — onStage hook (pure, no Creative Job coupling)", () => {
  it("fires rendering -> qa -> uploading, in order, exactly once each, on the happy path", async () => {
    const { deps } = buildDeps();
    const stages: string[] = [];
    await produceVideoAsset(baseInput(), { ...deps, onStage: (s) => void stages.push(s) });
    expect(stages).toEqual(["rendering", "qa", "uploading"]);
  });

  it("fires rendering + qa but NOT uploading when QA fails (uploading never starts)", async () => {
    const { deps } = buildDeps({
      qaResult: okQaResult({ ok: false, checks: { ...okQaResult().checks, codec: false } }),
    });
    const stages: string[] = [];
    await expect(
      produceVideoAsset(baseInput(), { ...deps, onStage: (s) => void stages.push(s) }),
    ).rejects.toThrow(RenderQaFailedError);
    expect(stages).toEqual(["rendering", "qa"]);
  });

  it("never fires any stage when download fails (throws before onStage exists to call)", async () => {
    const { deps } = buildDeps();
    const stages: string[] = [];
    const failingDeps: ProduceVideoAssetDeps = {
      ...deps,
      onStage: (s) => void stages.push(s),
      downloadAssets: async () => {
        throw new Error("network blip");
      },
    };
    await expect(produceVideoAsset(baseInput(), failingDeps)).rejects.toThrow(/network blip/);
    expect(stages).toEqual([]);
  });

  it("is optional — omitting it changes nothing about the happy path", async () => {
    const { deps } = buildDeps();
    const result = await produceVideoAsset(baseInput(), deps); // no onStage supplied
    expect(result.outputAsset.kind).toBe("video");
  });
});

describe("produceVideoAsset — typed per-stage errors (for pipeline.ts's error-code mapping)", () => {
  it("wraps a download failure in AssetDownloadFailedError, message preserved", async () => {
    const { deps } = buildDeps();
    const failingDeps: ProduceVideoAssetDeps = {
      ...deps,
      downloadAssets: async () => {
        throw new Error("network blip");
      },
    };
    await expect(produceVideoAsset(baseInput(), failingDeps)).rejects.toThrow(AssetDownloadFailedError);
    await expect(produceVideoAsset(baseInput(), failingDeps)).rejects.toThrow(/network blip/);
  });

  it("wraps an upload failure in StorageUploadFailedError, message preserved", async () => {
    const { deps } = buildDeps({ failUpload: true });
    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(StorageUploadFailedError);
    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(/upload failed/);
  });

  it("wraps a read-verify failure in StorageVerifyFailedError, message preserved", async () => {
    const { deps } = buildDeps({ failReadVerify: true });
    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(StorageVerifyFailedError);
    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(/read-verify/);
  });

  it("wraps an Asset-creation failure in AssetPersistFailedError, message preserved", async () => {
    const { deps } = buildDeps({ failInsert: true });
    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(AssetPersistFailedError);
    await expect(produceVideoAsset(baseInput(), deps)).rejects.toThrow(/insert failed/);
  });
});

describe("produceVideoAsset — module isolation (no Creative Job coupling)", () => {
  it("no source file in src/lib/video-engine imports @/lib/creative-jobs (requirement 1)", () => {
    // Scans actual source files (not this test file itself, which legitimately
    // mentions the module in prose/assertions) for a real import/require of the
    // Creative Job state machine — not merely the substring anywhere (comments in
    // these files explain the ABSENCE of such an import using that same path).
    //
    // EXCEPTION: pipeline.ts (Gate C1's orchestrator, src/lib/video-engine/pipeline.ts)
    // and worker-deps.ts (Gate D1's real produce/reconcile wiring,
    // src/lib/video-engine/worker-deps.ts) are deliberately excluded — pipeline.ts
    // bridges produceVideoAsset's pure `onStage` hook to Creative Job state
    // transitions, and worker-deps.ts's `reconcile` is typed
    // `(job: CreativeJob) => Promise<ReconcileResult>`, so importing @/lib/creative-jobs
    // is expected and correct in both. produceVideoAsset itself, the only thing
    // worker-deps.ts calls into this module for, still never imports it. Requirement 1
    // is about produceVideoAsset (and its low-level render/QA/storage/manifest
    // collaborators) staying state-machine-free — not about this directory as a whole.
    const dir = path.join(process.cwd(), "src", "lib", "video-engine");
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "pipeline.ts" && f !== "worker-deps.ts",
    );
    expect(files.length).toBeGreaterThan(0);
    const importPattern = /from\s+["']@\/lib\/creative-jobs|require\(\s*["']@\/lib\/creative-jobs/;
    for (const file of files) {
      const contents = readFileSync(path.join(dir, file), "utf8");
      expect(contents).not.toMatch(importPattern);
    }
  });
});

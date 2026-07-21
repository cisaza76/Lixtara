import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Asset, AssetStore, NewAsset } from "@/lib/assets/types";
import type { CreativeJob } from "@/lib/creative-jobs/jobs";
import { FakeRenderProvider, type RenderInput } from "@/lib/video-engine/render-provider";
import { createFakeStoragePort } from "@/lib/video-engine/storage-port";
import type { ExpectedTechnicalSpec, TechnicalQaResult } from "@/lib/video-engine/qa";
import {
  buildRealProduce,
  buildRealReconcile,
  defaultRunQa,
  resolveSandboxBaseArtifactFromEnv,
  MissingSandboxBaseArtifactError,
  parseStoragePublicUrl,
  ensureListingPhotoAssets,
  type ListingSummary,
} from "@/lib/video-engine/worker-deps";

// ---- fixtures ----------------------------------------------------------------------

function photoAsset(id: string, listingId = "listing-1"): Asset {
  return {
    id,
    listingId,
    ownerId: "owner-1",
    kind: "photo",
    version: 1,
    parentAsset: null,
    sourceType: "property_photo",
    sourceId: id,
    provenance: { sourceAssetIds: [], capability: "photo", engine: "asset-manager", provider: "seller_upload", prompt: null },
    storageBucket: "property-photos",
    storagePath: `${listingId}/${id}.jpg`,
    checksum: null,
    bytes: 1000,
    mime: "image/jpeg",
    costUsd: 0,
    costProvider: null,
    createdBy: "owner-1",
    lifecycle: "approved",
    qa: null,
    policy: null,
    createdAt: `2026-07-15T00:00:0${id.slice(-1)}.000Z`,
  };
}

function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "video-asset-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    kind: "video",
    version: 1,
    parentAsset: null,
    sourceType: "generated",
    sourceId: null,
    provenance: {
      sourceAssetIds: ["photo-1", "photo-2"],
      capability: "video",
      engine: "video-engine",
      provider: "remotion",
      prompt: null,
      traceId: "trace-abc",
    } as unknown as Asset["provenance"],
    storageBucket: "creative-studio",
    storagePath: "owner-1/listing-1/video-asset-1/v1/listing-video.mp4",
    checksum: "abc123",
    bytes: 1234,
    mime: "video/mp4",
    costUsd: 0.01,
    costProvider: "vercel-sandbox",
    createdBy: "owner-1",
    lifecycle: "ready_for_review",
    qa: null,
    policy: null,
    createdAt: "2026-07-15T00:01:00.000Z",
    ...overrides,
  };
}

function fakeAssetStore(seed: Asset[] = []): AssetStore & { rows: Asset[] } {
  const rows: Asset[] = [...seed];
  return {
    rows,
    async insert(a: NewAsset) {
      const row = { ...a, id: `video-asset-${rows.length + 1}`, createdAt: "2026-07-15T00:02:00.000Z" } as Asset;
      rows.push(row);
      return row;
    },
    async findBySource(sourceType, sourceId) {
      return rows.find((r) => r.sourceType === sourceType && r.sourceId === sourceId) ?? null;
    },
    async listByListing(listingId) {
      return rows.filter((r) => r.listingId === listingId);
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

function okQaResult(): TechnicalQaResult {
  return {
    ok: true,
    container: "mp4",
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: "30/1",
    durationSec: 6.5,
    bytes: 37,
    checksumSha256: "fake-checksum",
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
  };
}

function runningJob(overrides: Partial<CreativeJob> = {}): CreativeJob {
  return {
    id: "job-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    capability: "video",
    state: "running",
    assetId: null,
    idempotencyKey: "idem-1",
    attempts: 0,
    maxAttempts: 3,
    claimedAt: null,
    claimedBy: "worker-1",
    heartbeatAt: null,
    cancellationRequested: false,
    timeoutMs: 600_000,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    traceId: "trace-abc",
    ...overrides,
  };
}

// ---- defaultRunQa: parses the render provider's ffprobeJson, no host ffprobe spawn --

const REAL_QA_EXPECTED: ExpectedTechnicalSpec = {
  container: "mp4",
  codec: "h264",
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 13.5,
  toleranceSec: 2,
};

function ffprobeJsonFixture(overrides: { codec_name?: string } = {}): string {
  return JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: overrides.codec_name ?? "h264",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
        duration: "13.500000",
      },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "13.500000" },
  });
}

describe("defaultRunQa", () => {
  it("parses the provider-supplied ffprobeJson via the pure parseFfprobe — no ffprobe process spawned", async () => {
    const bytes = Buffer.from("FAKE-MP4-BYTES-FOR-CHECKSUM");
    const result = await defaultRunQa(ffprobeJsonFixture(), bytes, REAL_QA_EXPECTED);

    expect(result.ok).toBe(true);
    expect(result.container).toContain("mp4");
    expect(result.codec).toBe("h264");
  });

  it("fails when the ffprobeJson reports a spoofed/wrong codec — same JSON parsing, no host binary", async () => {
    const bytes = Buffer.from("FAKE-MP4-BYTES-FOR-CHECKSUM");
    const result = await defaultRunQa(ffprobeJsonFixture({ codec_name: "hevc" }), bytes, REAL_QA_EXPECTED);

    expect(result.ok).toBe(false);
    expect(result.checks.codec).toBe(false);
  });
});

// ---- buildRealProduce ---------------------------------------------------------------

describe("buildRealProduce — wires produceVideoAsset with a real-shaped deps set", () => {
  it("resolves listing + source photo Assets, downloads them, and calls produceVideoAsset via the injected render/storage/assets", async () => {
    const assetsStore = fakeAssetStore([photoAsset("photo-1"), photoAsset("photo-2")]);
    const render = new FakeRenderProvider();
    const storage = createFakeStoragePort();
    const downloadCalls: { assetId: string; destPath: string }[] = [];
    const loadListing = async (listingId: string): Promise<ListingSummary | null> =>
      listingId === "listing-1" ? { addressLine: "123 Ocean Dr, Doral, FL 33178", priceLabel: "$450,000" } : null;

    const produce = buildRealProduce({
      assets: assetsStore,
      storage,
      render,
      runQa: async () => okQaResult(),
      loadListing,
      downloadAsset: async (asset, destPath) => {
        downloadCalls.push({ assetId: asset.id, destPath });
        await writeFile(destPath, Buffer.from("FAKE-PHOTO-BYTES"));
      },
      now: () => Date.now(),
      brandName: "Lixtara",
      ctaText: "See more at lixtara.com",
      tempDirPrefix: "worker-deps-test-",
    });

    const stages: string[] = [];
    const result = await produce(
      { jobId: "job-1", listingId: "listing-1", ownerId: "owner-1", traceId: "trace-abc" },
      { onStage: (s) => void stages.push(s) },
    );

    // The pure onStage contract (produce-asset.ts) still fires in order.
    expect(stages).toEqual(["rendering", "qa", "uploading"]);

    // Downloaded exactly the listing's photo Assets, in order.
    expect(downloadCalls.map((c) => c.assetId)).toEqual(["photo-1", "photo-2"]);

    // The render provider received a real-shaped RenderInput: correct composition,
    // two local asset paths (matching what was "downloaded" above), and inputProps
    // that parse as a valid listingVideoInputSchema with badge:null.
    expect(render.calls).toHaveLength(1);
    const call: RenderInput = render.calls[0];
    expect(call.compositionId).toBe("ListingVideo");
    expect(call.localAssetPaths).toEqual(downloadCalls.map((c) => c.destPath));
    const inputProps = call.inputProps as {
      property: { addressLine: string };
      priceLabel: string;
      photos: { url: string }[];
      badge: null;
    };
    expect(inputProps.property.addressLine).toBe("123 Ocean Dr, Doral, FL 33178");
    expect(inputProps.priceLabel).toBe("$450,000");
    expect(inputProps.photos.map((p) => p.url)).toEqual(downloadCalls.map((c) => c.destPath));
    expect(inputProps.badge).toBeNull();

    // produceVideoAsset ran the full real persistence path against the injected
    // storage/assets fakes.
    expect(result.outputAsset.kind).toBe("video");
    expect(storage.uploaded).toHaveLength(1);
    // 2 seeded photo Assets + 1 newly-created video Asset.
    expect(assetsStore.rows.filter((r) => r.kind === "video")).toHaveLength(1);

    // The per-job temp dir is cleaned up afterward.
    const tempDir = path.dirname(call.localAssetPaths[0]);
    expect(existsSync(tempDir)).toBe(false);
  });

  it("throws when the listing cannot be resolved", async () => {
    const assetsStore = fakeAssetStore([photoAsset("photo-1")]);
    const produce = buildRealProduce({
      assets: assetsStore,
      storage: createFakeStoragePort(),
      render: new FakeRenderProvider(),
      runQa: async () => okQaResult(),
      loadListing: async () => null,
      downloadAsset: async () => {},
      now: () => Date.now(),
      brandName: "Lixtara",
      ctaText: "See more at lixtara.com",
      tempDirPrefix: "worker-deps-test-",
    });

    await expect(
      produce({ jobId: "job-1", listingId: "listing-1", ownerId: "owner-1", traceId: null }, { onStage: async () => {} }),
    ).rejects.toThrow(/listing not found/);
  });

  it("throws when the listing has no source photo Assets", async () => {
    const assetsStore = fakeAssetStore([]); // no photos wrapped yet
    const produce = buildRealProduce({
      assets: assetsStore,
      storage: createFakeStoragePort(),
      render: new FakeRenderProvider(),
      runQa: async () => okQaResult(),
      loadListing: async () => ({ addressLine: "123 Ocean Dr", priceLabel: "$450,000" }),
      downloadAsset: async () => {},
      now: () => Date.now(),
      brandName: "Lixtara",
      ctaText: "See more at lixtara.com",
      tempDirPrefix: "worker-deps-test-",
    });

    await expect(
      produce({ jobId: "job-1", listingId: "listing-1", ownerId: "owner-1", traceId: null }, { onStage: async () => {} }),
    ).rejects.toThrow(/no source photo Assets/);
  });

  it("cleans up its temp dir even when the render/QA/upload path throws", async () => {
    const assetsStore = fakeAssetStore([photoAsset("photo-1")]);
    let capturedTempDir = "";
    const produce = buildRealProduce({
      assets: assetsStore,
      storage: createFakeStoragePort(),
      render: {
        async render(input) {
          capturedTempDir = path.dirname(input.localAssetPaths[0]);
          throw new Error("render exploded");
        },
      },
      runQa: async () => okQaResult(),
      loadListing: async () => ({ addressLine: "123 Ocean Dr", priceLabel: "$450,000" }),
      downloadAsset: async (_asset, destPath) => {
        await writeFile(destPath, Buffer.from("x"));
      },
      now: () => Date.now(),
      brandName: "Lixtara",
      ctaText: "See more at lixtara.com",
      tempDirPrefix: "worker-deps-test-",
    });

    await expect(
      produce({ jobId: "job-1", listingId: "listing-1", ownerId: "owner-1", traceId: null }, { onStage: async () => {} }),
    ).rejects.toThrow(/render exploded/);

    expect(capturedTempDir).not.toBe("");
    expect(existsSync(capturedTempDir)).toBe(false);
  });
});

// ---- buildRealReconcile --------------------------------------------------------------

describe("buildRealReconcile", () => {
  it("returns alreadyDone:true when the job's own assetId matches a persisted Asset", async () => {
    const assetsStore = fakeAssetStore([videoAsset({ id: "video-asset-EXISTING" })]);
    const reconcile = buildRealReconcile(assetsStore);

    const result = await reconcile(runningJob({ assetId: "video-asset-EXISTING" }));

    expect(result.alreadyDone).toBe(true);
    expect(result.asset?.id).toBe("video-asset-EXISTING");
  });

  it("returns alreadyDone:true when a video Asset's provenance.traceId matches the job's traceId (no assetId set yet)", async () => {
    const assetsStore = fakeAssetStore([videoAsset({ id: "video-asset-BY-TRACE" })]);
    const reconcile = buildRealReconcile(assetsStore);

    const result = await reconcile(runningJob({ assetId: null, traceId: "trace-abc" }));

    expect(result.alreadyDone).toBe(true);
    expect(result.asset?.id).toBe("video-asset-BY-TRACE");
  });

  it("returns alreadyDone:false when neither assetId nor traceId match anything persisted", async () => {
    const assetsStore = fakeAssetStore([videoAsset({ id: "video-asset-OTHER" })]);
    const reconcile = buildRealReconcile(assetsStore);

    const result = await reconcile(runningJob({ assetId: null, traceId: "trace-does-not-match" }));

    expect(result).toEqual({ alreadyDone: false });
  });

  it("returns alreadyDone:false for a fresh job with no assetId and no traceId", async () => {
    const assetsStore = fakeAssetStore([]);
    const reconcile = buildRealReconcile(assetsStore);

    const result = await reconcile(runningJob({ assetId: null, traceId: null }));

    expect(result).toEqual({ alreadyDone: false });
  });
});

// ---- resolveSandboxBaseArtifactFromEnv ------------------------------------------------

describe("resolveSandboxBaseArtifactFromEnv", () => {
  const prevSnapshot = process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID;
  const prevImage = process.env.CREATIVE_STUDIO_SANDBOX_IMAGE;

  afterEach(() => {
    if (prevSnapshot === undefined) delete process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID;
    else process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID = prevSnapshot;
    if (prevImage === undefined) delete process.env.CREATIVE_STUDIO_SANDBOX_IMAGE;
    else process.env.CREATIVE_STUDIO_SANDBOX_IMAGE = prevImage;
  });

  it("throws MissingSandboxBaseArtifactError when neither env var is set", () => {
    delete process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID;
    delete process.env.CREATIVE_STUDIO_SANDBOX_IMAGE;
    expect(() => resolveSandboxBaseArtifactFromEnv()).toThrow(MissingSandboxBaseArtifactError);
  });

  it("prefers CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID when set", () => {
    process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID = "snap-123";
    delete process.env.CREATIVE_STUDIO_SANDBOX_IMAGE;
    expect(resolveSandboxBaseArtifactFromEnv()).toEqual({ snapshotId: "snap-123" });
  });

  it("falls back to CREATIVE_STUDIO_SANDBOX_IMAGE when no snapshot id is set", () => {
    delete process.env.CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID;
    process.env.CREATIVE_STUDIO_SANDBOX_IMAGE = "ghcr.io/example/image:tag";
    expect(resolveSandboxBaseArtifactFromEnv()).toEqual({ image: "ghcr.io/example/image:tag" });
  });
});

// ---- Bloqueo 2 fix: wrap seller property_photos into source photo Assets --------------

describe("parseStoragePublicUrl — derives {bucket, path} from a Supabase storage URL", () => {
  it("parses a public object URL", () => {
    expect(
      parseStoragePublicUrl(
        "https://ref.supabase.co/storage/v1/object/public/property-photos/owner-1/listing-1/pic.jpg",
      ),
    ).toEqual({ bucket: "property-photos", path: "owner-1/listing-1/pic.jpg" });
  });

  it("parses a signed object URL and strips the query string", () => {
    expect(
      parseStoragePublicUrl(
        "https://ref.supabase.co/storage/v1/object/sign/property-photos/a/b.png?token=xyz.abc",
      ),
    ).toEqual({ bucket: "property-photos", path: "a/b.png" });
  });

  it("returns null for a URL that is not a Supabase storage object URL", () => {
    expect(parseStoragePublicUrl("https://example.com/not-storage/x.jpg")).toBeNull();
  });
});

describe("ensureListingPhotoAssets — wraps property_photos into kind=photo Assets (idempotent)", () => {
  const L = "listing-1";
  const O = "owner-1";
  const photos = [
    { id: "pp-1", url: "https://ref.supabase.co/storage/v1/object/public/property-photos/owner-1/listing-1/a.jpg" },
    { id: "pp-2", url: "https://ref.supabase.co/storage/v1/object/public/property-photos/owner-1/listing-1/b.jpg" },
  ];

  it("creates a kind=photo Asset per property_photo with bucket/path parsed from the URL", async () => {
    const store = fakeAssetStore([]);
    await ensureListingPhotoAssets(store, photos, L, O);

    const wrapped = store.rows.filter((r) => r.kind === "photo");
    expect(wrapped).toHaveLength(2);
    expect(wrapped.map((r) => r.sourceId).sort()).toEqual(["pp-1", "pp-2"]);
    expect(wrapped.every((r) => r.sourceType === "property_photo")).toBe(true);
    expect(wrapped.every((r) => r.storageBucket === "property-photos")).toBe(true);
    expect(wrapped.find((r) => r.sourceId === "pp-1")?.storagePath).toBe("owner-1/listing-1/a.jpg");
  });

  it("is idempotent — a second run wraps nothing new (findBySource guard)", async () => {
    const store = fakeAssetStore([]);
    await ensureListingPhotoAssets(store, photos, L, O);
    await ensureListingPhotoAssets(store, photos, L, O);
    expect(store.rows.filter((r) => r.kind === "photo")).toHaveLength(2);
  });

  it("skips a photo whose URL cannot be parsed rather than throwing", async () => {
    const store = fakeAssetStore([]);
    await ensureListingPhotoAssets(
      store,
      [{ id: "pp-x", url: "https://example.com/not-storage/x.jpg" }, ...photos],
      L,
      O,
    );
    expect(store.rows.filter((r) => r.kind === "photo")).toHaveLength(2);
  });
});

describe("buildRealProduce — ensures photo Assets exist before selecting (Bloqueo 2 wiring)", () => {
  it("a listing with property_photos but no Assets yet still renders (ensurePhotoAssets wraps first)", async () => {
    const store = fakeAssetStore([]); // real seller state: photos exist, Assets don't
    let ensureCalledBeforeSelect = false;
    const produce = buildRealProduce({
      assets: store,
      storage: createFakeStoragePort(),
      render: new FakeRenderProvider(),
      runQa: async () => okQaResult(),
      loadListing: async () => ({ addressLine: "123 Ocean Dr", priceLabel: "$450,000" }),
      downloadAsset: async () => {},
      now: () => Date.now(),
      brandName: "Lixtara",
      ctaText: "See more at lixtara.com",
      tempDirPrefix: "worker-deps-test-",
      ensurePhotoAssets: async (listingId, ownerId) => {
        ensureCalledBeforeSelect = store.rows.filter((r) => r.kind === "photo").length === 0;
        await store.insert(photoAsset("wrapped-1", listingId) as unknown as NewAsset);
        void ownerId;
      },
    });

    await expect(
      produce({ jobId: "job-1", listingId: "listing-1", ownerId: "owner-1", traceId: null }, { onStage: async () => {} }),
    ).resolves.toBeTruthy();
    expect(ensureCalledBeforeSelect).toBe(true);
  });
});

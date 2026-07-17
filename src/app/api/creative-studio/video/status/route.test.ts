import { describe, it, expect } from "vitest";
import { handleVideoStatus, type VideoStatusDeps } from "@/app/api/creative-studio/video/status/route";
import type { CreativeJob } from "@/lib/creative-jobs/jobs";
import type { Asset } from "@/lib/assets/types";

const PROPERTY_ID = "prop-1";
const OWNER_ID = "user-1";

function makeJob(over: Partial<CreativeJob> = {}): CreativeJob {
  return {
    id: "job-1",
    listingId: PROPERTY_ID,
    ownerId: OWNER_ID,
    capability: "video",
    state: "queued",
    assetId: null,
    idempotencyKey: "key-1",
    attempts: 0,
    maxAttempts: 3,
    claimedAt: null,
    claimedBy: null,
    heartbeatAt: null,
    cancellationRequested: false,
    timeoutMs: 60_000,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    traceId: "trace-1",
    ...over,
  } as unknown as CreativeJob;
}

function makeAsset(over: Partial<Asset> = {}): Asset {
  return {
    id: "A1",
    listingId: PROPERTY_ID,
    ownerId: OWNER_ID,
    kind: "video",
    version: 1,
    parentAsset: null,
    sourceType: "generated",
    sourceId: null,
    provenance: {
      sourceAssetIds: ["1", "2"],
      capability: "video",
      engine: "video-engine",
      provider: "remotion",
      prompt: null,
    },
    storageBucket: "creative-studio",
    storagePath: "creative-studio/prop-1/video/A1.mp4",
    checksum: null,
    bytes: 1234,
    mime: "video/mp4",
    costUsd: 0,
    costProvider: null,
    createdBy: OWNER_ID,
    lifecycle: "approved",
    qa: { durationSec: 17, width: 1920, height: 1080 },
    policy: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  } as Asset;
}

function makeDeps(over: Partial<VideoStatusDeps> = {}): VideoStatusDeps {
  return {
    getUser: async () => ({ id: OWNER_ID }),
    loadProperty: async () => ({ id: PROPERTY_ID, owner_id: OWNER_ID }),
    findLatestByListing: async () => null,
    getAsset: async () => null,
    signUrls: async () => null,
    ...over,
  };
}

function req(propertyId?: string): Request {
  const url =
    propertyId === undefined
      ? "http://t/api/creative-studio/video/status"
      : `http://t/api/creative-studio/video/status?property_id=${encodeURIComponent(propertyId)}`;
  return new Request(url);
}

describe("handleVideoStatus", () => {
  it("returns 401 when unauthenticated", async () => {
    const deps = makeDeps({ getUser: async () => null });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "not_authenticated" });
  });

  it("returns 400 when property_id is missing", async () => {
    const deps = makeDeps();
    const res = await handleVideoStatus(req(), deps);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "property_id_required" });
  });

  it("returns 403 when the property doesn't exist", async () => {
    const deps = makeDeps({ loadProperty: async () => null });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "property_not_found_or_not_yours" });
  });

  it("returns 403 when the authed user isn't the property's owner", async () => {
    const deps = makeDeps({
      loadProperty: async () => ({ id: PROPERTY_ID, owner_id: "someone-else" }),
    });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "property_not_found_or_not_yours" });
  });

  it("returns idle when there is no job yet", async () => {
    const deps = makeDeps({ findLatestByListing: async () => null });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ state: "idle", video: null });
  });

  it("returns creating when the job is rendering", async () => {
    const deps = makeDeps({ findLatestByListing: async () => makeJob({ state: "rendering" }) });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ state: "creating", video: null });
  });

  it("returns failed when the job failed", async () => {
    const deps = makeDeps({ findLatestByListing: async () => makeJob({ state: "failed" }) });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ state: "failed", video: null });
  });

  it("returns completed with signed urls + meta on a completed job with a servable asset", async () => {
    const deps = makeDeps({
      findLatestByListing: async () => makeJob({ state: "completed", assetId: "A1" }),
      getAsset: async () => makeAsset(),
      signUrls: async () => ({ previewUrl: "https://signed/preview", downloadUrl: "https://signed/dl" }),
    });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      state: "completed",
      video: {
        previewUrl: "https://signed/preview",
        downloadUrl: "https://signed/dl",
        meta: {
          durationSeconds: 17,
          resolutionLabel: "1080p",
          photoCount: 2,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      },
    });
  });

  it("degrades to creating when the completed job's asset is missing", async () => {
    const deps = makeDeps({
      findLatestByListing: async () => makeJob({ state: "completed", assetId: "A1" }),
      getAsset: async () => null,
      signUrls: async () => ({ previewUrl: "https://signed/preview", downloadUrl: "https://signed/dl" }),
    });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ state: "creating", video: null });
  });

  it("degrades to creating when signing is unavailable", async () => {
    const deps = makeDeps({
      findLatestByListing: async () => makeJob({ state: "completed", assetId: "A1" }),
      getAsset: async () => makeAsset(),
      signUrls: async () => null,
    });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ state: "creating", video: null });
  });

  it("never leaks storage paths/buckets/error codes/traceId/idempotencyKey or raw internal state strings", async () => {
    const deps = makeDeps({
      findLatestByListing: async () => makeJob({ state: "completed", assetId: "A1" }),
      getAsset: async () => makeAsset(),
      signUrls: async () => ({ previewUrl: "https://signed/preview", downloadUrl: "https://signed/dl" }),
    });
    const res = await handleVideoStatus(req(PROPERTY_ID), deps);
    const bodyText = JSON.stringify(await res.json());
    for (const forbidden of [
      "storagePath",
      "storageBucket",
      "errorCode",
      "traceId",
      "idempotencyKey",
      "rendering",
      "uploading",
    ]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });
});

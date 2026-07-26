import { describe, it, expect, afterEach } from "vitest";
import { handleReadSource, GET, type SourceReadDeps } from "./route";
import type { Asset } from "@/lib/assets/types";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";

function req(listingId = LISTING): Request {
  return new Request(`http://x/api/creative-studio/video/source?listingId=${listingId}`);
}
const sourceAsset = (o: Partial<Asset> = {}): Asset => ({
  id: "asset-1", listingId: LISTING, ownerId: OWNER, kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: "up-1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: "source/O/L/asset-1/source.mp4", checksum: null, bytes: 12_345_678,
  mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: OWNER, lifecycle: "draft", qa: null, policy: null,
  createdAt: "2026-07-23T10:00:00.000Z", ...o,
});
function deps(over: Partial<SourceReadDeps> = {}): SourceReadDeps {
  return {
    getUser: over.getUser ?? (async () => ({ id: OWNER })),
    loadProperty: over.loadProperty ?? (async (id) => ({ id, owner_id: OWNER })),
    loadCurrentSource: over.loadCurrentSource ?? (async () => null),
  };
}

describe("GET /source (read-only)", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("flag OFF → 404", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    expect((await GET(req())).status).toBe(404);
  });
  it("unauthenticated → 401", async () => {
    expect((await handleReadSource(req(), deps({ getUser: async () => null }))).status).toBe(401);
  });
  it("invalid listingId → 400", async () => {
    expect((await handleReadSource(req("nope"), deps())).status).toBe(400);
  });
  it("not the owner → 403", async () => {
    expect((await handleReadSource(req(), deps({ loadProperty: async (id) => ({ id, owner_id: "x" }) }))).status).toBe(403);
  });
  it("listing without a source → exists:false", async () => {
    const r = await handleReadSource(req(), deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ exists: false });
  });
  it("listing with a source → seller DTO, no internal fields leaked", async () => {
    const r = await handleReadSource(req(), deps({ loadCurrentSource: async () => sourceAsset() }));
    const j = await r.json();
    expect(j).toEqual({
      exists: true,
      source: { assetId: "asset-1", sizeBytes: 12_345_678, mimeType: "video/mp4", uploadedAt: "2026-07-23T10:00:00.000Z", status: "pending_validation" },
    });
    const serialized = JSON.stringify(j);
    expect(serialized).not.toMatch(/storagePath|storageBucket|creative-studio|provenance|token|signedUrl/i);
  });
});

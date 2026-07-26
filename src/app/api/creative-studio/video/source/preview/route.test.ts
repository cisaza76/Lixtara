import { describe, it, expect, afterEach } from "vitest";
import { handleSourcePreview, GET, type SourcePreviewDeps } from "./route";
import type { Asset } from "@/lib/assets/types";
import type { TemporaryMediaAccess } from "@/lib/creative-studio/source-preview";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";

function req(listingId = LISTING): Request {
  return new Request(`http://x/api/creative-studio/video/source/preview?listingId=${listingId}`);
}
const asset = (o: Partial<Asset> = {}): Asset => ({
  id: "asset-1", listingId: LISTING, ownerId: OWNER, kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: "up-1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: "source/O/L/asset-1/source.mp4", checksum: null, bytes: 12_345_678,
  mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: OWNER, lifecycle: "draft", qa: null, policy: null,
  createdAt: "2026-07-23T10:00:00.000Z", ...o,
});
const ACCESS: TemporaryMediaAccess = { locator: "https://signed.example/x?token=abc", expiresAt: "2026-07-23T10:05:00.000Z" };

function deps(over: Partial<SourcePreviewDeps> = {}): SourcePreviewDeps {
  return {
    getUser: over.getUser ?? (async () => ({ id: OWNER })),
    loadProperty: over.loadProperty ?? (async (id) => ({ id, owner_id: OWNER })),
    loadCurrentSource: over.loadCurrentSource ?? (async () => asset()),
    createTemporaryAccess: over.createTemporaryAccess ?? (async () => ACCESS),
  };
}

describe("GET /source/preview (owner-only, ephemeral access)", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("flag OFF → 404", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    expect((await GET(req())).status).toBe(404);
  });
  it("unauthenticated → 401", async () => {
    expect((await handleSourcePreview(req(), deps({ getUser: async () => null }))).status).toBe(401);
  });
  it("invalid listingId → 400", async () => {
    expect((await handleSourcePreview(req("nope"), deps())).status).toBe(400);
  });
  it("not the owner → 403", async () => {
    expect((await handleSourcePreview(req(), deps({ loadProperty: async (id) => ({ id, owner_id: "x" }) }))).status).toBe(403);
  });
  it("no source → exists:false", async () => {
    const r = await handleSourcePreview(req(), deps({ loadCurrentSource: async () => null }));
    expect(await r.json()).toEqual({ exists: false });
  });
  it("with source → temporary-access DTO built from the server-side signed URL; the client never supplies the path", async () => {
    let calledPath = "";
    const r = await handleSourcePreview(
      req(),
      deps({ createTemporaryAccess: async (bucket, path) => { calledPath = `${bucket}:${path}`; return ACCESS; } }),
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.exists).toBe(true);
    expect(j.preview.access).toEqual(ACCESS);
    expect(j.preview.meta).toMatchObject({ mimeType: "video/mp4", sizeBytes: 12_345_678, durationSeconds: null });
    // server built the path from the Asset
    expect(calledPath).toBe("creative-studio:source/O/L/asset-1/source.mp4");
    // no internal fields leaked (the access.url is the ephemeral grant, allowed; no bucket/path)
    const s = JSON.stringify(j);
    expect(s).not.toMatch(/storagePath|storageBucket|provenance/i);
  });
  it("access unavailable → 503", async () => {
    expect((await handleSourcePreview(req(), deps({ createTemporaryAccess: async () => null }))).status).toBe(503);
  });
  it("responses are non-cacheable (private, no-store)", async () => {
    const ok = await handleSourcePreview(req(), deps());
    expect(ok.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    // also on the not-yours path (no access leaked, still uncacheable)
    const denied = await handleSourcePreview(req(), deps({ loadProperty: async (id) => ({ id, owner_id: "x" }) }));
    expect(denied.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});

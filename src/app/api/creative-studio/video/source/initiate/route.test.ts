import { describe, it, expect, afterEach } from "vitest";
import { handleInitiateSourceUpload, POST, type InitiateSourceDeps } from "./route";
import { SOURCE_BUCKET, buildSourceStoragePath } from "@/lib/creative-studio/source-upload";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

function req(body: unknown): Request {
  return new Request("http://x/api/creative-studio/video/source/initiate", { method: "POST", body: JSON.stringify(body) });
}
function deps(over: Partial<InitiateSourceDeps> = {}): InitiateSourceDeps {
  return {
    getUser: over.getUser ?? (async () => ({ id: OWNER })),
    loadProperty: over.loadProperty ?? (async (id) => ({ id, owner_id: OWNER })),
    checkRateLimit: over.checkRateLimit ?? (async () => null),
    createSignedUpload: over.createSignedUpload ?? (async () => ({ signedUrl: "https://signed.example/u", token: "tok-1" })),
    generateAssetId: over.generateAssetId ?? (() => ASSET),
  };
}
const goodBody = { listingId: LISTING, fileName: "clip.mp4", mimeType: "video/mp4", sizeBytes: 10_000_000 };

describe("initiate route", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("1. flag OFF → 404 (fail-closed)", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    expect((await POST(req(goodBody))).status).toBe(404);
  });
  it("3. unauthenticated → 401", async () => {
    const r = await handleInitiateSourceUpload(req(goodBody), deps({ getUser: async () => null }));
    expect(r.status).toBe(401);
  });
  it("4. not the listing owner → 403", async () => {
    const r = await handleInitiateSourceUpload(req(goodBody), deps({ loadProperty: async (id) => ({ id, owner_id: "someone-else" }) }));
    expect(r.status).toBe(403);
  });
  it("5. invalid mime → 400", async () => {
    const r = await handleInitiateSourceUpload(req({ ...goodBody, mimeType: "video/quicktime" }), deps());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_mime" });
  });
  it("6. size exceeded → 400 file_too_large", async () => {
    const r = await handleInitiateSourceUpload(req({ ...goodBody, sizeBytes: 400 * 1024 * 1024 }), deps());
    expect((await r.json()).error).toBe("file_too_large");
  });
  it("7. empty file → 400 empty_file", async () => {
    expect((await (await handleInitiateSourceUpload(req({ ...goodBody, sizeBytes: 0 }), deps())).json()).error).toBe("empty_file");
  });
  it("8. issues the correct server-owned namespace + signed upload", async () => {
    const r = await handleInitiateSourceUpload(req(goodBody), deps());
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.assetId).toBe(ASSET);
    expect(j.bucket).toBe(SOURCE_BUCKET);
    expect(j.storagePath).toBe(buildSourceStoragePath(OWNER, LISTING, ASSET));
    expect(j.upload).toEqual({ signedUrl: "https://signed.example/u", token: "tok-1" });
  });
  it("9. the client cannot choose the bucket or path (server builds both)", async () => {
    // Even if the client sends bucket/storagePath/assetId, the response ignores them.
    const r = await handleInitiateSourceUpload(
      req({ ...goodBody, bucket: "attacker-bucket", storagePath: "../evil", assetId: "client-chosen" }),
      deps(),
    );
    const j = await r.json();
    expect(j.bucket).toBe(SOURCE_BUCKET);
    expect(j.storagePath).toBe(buildSourceStoragePath(OWNER, LISTING, ASSET));
    expect(j.assetId).toBe(ASSET); // server-generated, not "client-chosen"
  });
  it("signed-upload failure → 500", async () => {
    const r = await handleInitiateSourceUpload(req(goodBody), deps({ createSignedUpload: async () => ({ error: "boom" }) }));
    expect(r.status).toBe(500);
  });
});

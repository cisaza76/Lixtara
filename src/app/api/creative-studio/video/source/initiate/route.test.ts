import { describe, it, expect, afterEach, vi } from "vitest";
import type { Ratelimit } from "@upstash/ratelimit";
import { handleInitiateSourceUpload, POST, type InitiateSourceDeps } from "./route";
import { enforceLimit } from "@/lib/ratelimit";
import { SOURCE_BUCKET, buildSourceStoragePath } from "@/lib/creative-studio/source-upload";
import type { VideoAccessResult } from "@/lib/creative-studio/video-access";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

// An allowlisted, in-scope grant. `deny(reason)` builds a fail-closed denial for the gating tests.
const ALLOW: VideoAccessResult = {
  allowed: true, reason: "allowed", userAllowed: true, listingAllowed: true,
  remainingGenerations: 1, consentRequired: false, consentSatisfied: true, grantId: "g1", grantGenerationsUsed: 0,
};
const deny = (reason: VideoAccessResult["reason"]): VideoAccessResult => ({
  ...ALLOW, allowed: false, reason, listingAllowed: false, remainingGenerations: 0, consentSatisfied: false,
  grantId: undefined, grantGenerationsUsed: undefined,
});

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
    checkAccess: over.checkAccess ?? (async () => ALLOW),
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
  it("4b. not allowlisted (no_grant) → 404 (feature invisible), no signed URL minted", async () => {
    let signed = false;
    const r = await handleInitiateSourceUpload(
      req(goodBody),
      deps({ checkAccess: async () => deny("no_grant"), createSignedUpload: async () => { signed = true; return { error: "x" }; } }),
    );
    expect(r.status).toBe(404);
    expect(signed).toBe(false);
  });
  it("4c. allowlisted but OUT OF QUOTA still initiates (quota does not gate upload)", async () => {
    const r = await handleInitiateSourceUpload(req(goodBody), deps({ checkAccess: async () => deny("quota_exhausted") }));
    expect(r.status).toBe(200);
  });
  it("5. invalid mime → 400", async () => {
    const r = await handleInitiateSourceUpload(req({ ...goodBody, mimeType: "video/webm" }), deps());
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

  it("rate-limit PROVIDER outage → route continues to its normal logic, never a 500 (incident 2026-07-26)", async () => {
    // Route-level regression for the Upstash outage: the production deps wire
    // checkRateLimit through the REAL enforceLimit. Before the hardening, a dead
    // Redis host made limiter.limit() throw `TypeError: fetch failed`, the
    // rejection propagated, and this route (like /api/loui and every other
    // rate-limited route) returned an empty 500. Now enforceLimit degrades to
    // fail-open + structured log, and the route completes its normal flow.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deadRedisLimiter = {
      limit: async () => {
        throw new TypeError("fetch failed", {
          cause: new Error("getaddrinfo ENOTFOUND stirred-moray-131131.upstash.io"),
        });
      },
    } as unknown as Ratelimit;
    const r = await handleInitiateSourceUpload(
      req(goodBody),
      deps({
        checkRateLimit: (userId) =>
          enforceLimit(deadRedisLimiter, `u:${userId}`, { label: "initiate-test", message: "wait" }),
      }),
    );
    expect(r.status).toBe(200); // full normal flow — the limiter outage did not surface
    const logged = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "rate_limit_provider_failure", action: "fail_open_bypass" });
    errSpy.mockRestore();
  });
});

describe("Etapa 1 — MOV: el key refleja el contenedor real", () => {
  it("un .mov produce storagePath source.mov (nunca source.mp4)", async () => {
    const res = await handleInitiateSourceUpload(
      req({ ...goodBody, fileName: "IMG_6371.MOV", mimeType: "video/quicktime", sizeBytes: 48_412_268 }),
      deps(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storagePath.endsWith("/source.mov")).toBe(true);
  });

  it("un .mp4 conserva source.mp4 (sin regresión)", async () => {
    const res = await handleInitiateSourceUpload(req(goodBody), deps());
    const body = await res.json();
    expect(body.storagePath.endsWith("/source.mp4")).toBe(true);
  });
});

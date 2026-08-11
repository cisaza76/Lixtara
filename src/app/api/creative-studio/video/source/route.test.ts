import { describe, it, expect, afterEach } from "vitest";
import { handleReadSource, GET, type SourceReadDeps } from "./route";
import type { Asset } from "@/lib/assets/types";
import type { VideoAccessResult } from "@/lib/creative-studio/video-access";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";

const ALLOW: VideoAccessResult = {
  allowed: true, reason: "allowed", userAllowed: true, listingAllowed: true,
  remainingGenerations: 1, consentRequired: false, consentSatisfied: true, grantId: "g1", grantGenerationsUsed: 0,
};
const deny = (reason: VideoAccessResult["reason"]): VideoAccessResult => ({
  ...ALLOW, allowed: false, reason, listingAllowed: false, remainingGenerations: 0, consentSatisfied: false,
  grantId: undefined, grantGenerationsUsed: undefined,
});

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
    checkAccess: over.checkAccess ?? (async () => ALLOW),
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
  it("not allowlisted (no_grant) → 404 (source status stays invisible)", async () => {
    const r = await handleReadSource(req(), deps({ checkAccess: async () => deny("no_grant"), loadCurrentSource: async () => sourceAsset() }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
  it("out of quota still reads source status (quota does not gate reads)", async () => {
    const r = await handleReadSource(req(), deps({ checkAccess: async () => deny("quota_exhausted") }));
    expect(r.status).toBe(200);
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

// ==========================================================================================
// DELETE /source — eliminación del Source Video por el vendedor.
// Contrato: archiva el source VIGENTE, borra sus bytes, conserva fila/provenance/activity_log,
// y NUNCA toca assets generados, jobs ni cuota.
// ==========================================================================================
import { handleRemoveSource, DELETE, type SourceRemoveDeps } from "./route";

function delReq(listingId = LISTING): Request {
  return new Request(`http://x/api/creative-studio/video/source?listingId=${listingId}`, { method: "DELETE" });
}

function removeDepsFake(over: Partial<SourceRemoveDeps> = {}, seed: Asset[] = [sourceAsset()]) {
  const store = [...seed];
  const fx = { archived: [] as string[], deleted: [] as string[], audits: [] as string[], quotaTouched: false, jobsTouched: false };
  const base = deps(over);
  const d: SourceRemoveDeps = {
    ...base,
    loadCurrentSource: over.loadCurrentSource ?? (async (listingId, ownerId) =>
      store.find((a) => a.listingId === listingId && a.ownerId === ownerId && a.kind === "video"
        && a.sourceType === "seller_upload" && a.lifecycle !== "archived") ?? null),
    checkRateLimit: over.checkRateLimit ?? (async () => null),
    removal: over.removal ?? {
      archive: async ({ assetId, ownerId }) => {
        const a = store.find((x) => x.id === assetId && x.ownerId === ownerId);
        if (!a) return "not_found";
        if (a.lifecycle === "archived") return "already_archived";
        a.lifecycle = "archived";
        fx.archived.push(assetId);
        return "archived";
      },
      deleteObject: async (_b, path) => { fx.deleted.push(path); return true; },
      audit: {
        exists: async ({ assetId }) => fx.audits.includes(assetId),
        insert: async ({ assetId }) => { fx.audits.push(assetId); },
      },
    },
  };
  return { d, fx, store };
}

describe("DELETE /source — puertas de seguridad", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("flag OFF → 404 (invisible)", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    expect((await DELETE(delReq())).status).toBe(404);
  });
  it("sin sesión → 401 y no toca nada", async () => {
    const { d, fx } = removeDepsFake({ getUser: async () => null });
    expect((await handleRemoveSource(delReq(), d)).status).toBe(401);
    expect(fx.archived).toHaveLength(0);
    expect(fx.deleted).toHaveLength(0);
  });
  it("OTRO usuario no puede eliminar → 403 y el source sigue vivo", async () => {
    const { d, fx, store } = removeDepsFake({ loadProperty: async (id) => ({ id, owner_id: "otro-user" }) });
    expect((await handleRemoveSource(delReq(), d)).status).toBe(403);
    expect(fx.archived).toHaveLength(0);
    expect(store[0].lifecycle).toBe("draft");
  });
  it("cross-listing: un listing ajeno no expone ni elimina el source → 403", async () => {
    const OTRO_LISTING = "44444444-4444-4444-4444-444444444444";
    const { d, fx } = removeDepsFake({ loadProperty: async () => null });
    expect((await handleRemoveSource(delReq(OTRO_LISTING), d)).status).toBe(403);
    expect(fx.deleted).toHaveLength(0);
  });
  it("no allowlisted → 404 (misma invisibilidad que GET) y sin efectos", async () => {
    const { d, fx } = removeDepsFake({ checkAccess: async () => deny("no_grant") });
    expect((await handleRemoveSource(delReq(), d)).status).toBe(404);
    expect(fx.archived).toHaveLength(0);
  });
  it("listingId inválido → 400", async () => {
    const { d } = removeDepsFake();
    expect((await handleRemoveSource(delReq("nope"), d)).status).toBe(400);
  });
  it("rate limit → se propaga la respuesta del limitador", async () => {
    const { d } = removeDepsFake({ checkRateLimit: async () => new Response("slow down", { status: 429 }) });
    expect((await handleRemoveSource(delReq(), d)).status).toBe(429);
  });
});

describe("DELETE /source — semántica", () => {
  it("el owner elimina: archiva, borra bytes, audita y responde 200", async () => {
    const { d, fx, store } = removeDepsFake();
    const res = await handleRemoveSource(delReq(), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, assetId: "asset-1", storageDeleted: true });
    expect(fx.archived).toEqual(["asset-1"]);
    expect(fx.deleted).toEqual(["source/O/L/asset-1/source.mp4"]);
    expect(fx.audits).toEqual(["asset-1"]);
    expect(store[0].lifecycle).toBe("archived");
  });

  it("la fila del Asset y su provenance se conservan", async () => {
    const { d, store } = removeDepsFake();
    await handleRemoveSource(delReq(), d);
    expect(store).toHaveLength(1);
    expect(store[0].provenance).toEqual(sourceAsset().provenance);
    expect(store[0].sourceId).toBe("up-1");
  });

  it("el asset GENERADO permanece intacto y los jobs no se tocan", async () => {
    const generado = sourceAsset({ id: "render-1", kind: "render", sourceType: "generated", lifecycle: "ready_for_review", storagePath: "output/final.mp4" });
    const { d, fx, store } = removeDepsFake({}, [sourceAsset(), generado]);
    await handleRemoveSource(delReq(), d);
    expect(fx.archived).toEqual(["asset-1"]);
    expect(fx.deleted).toEqual(["source/O/L/asset-1/source.mp4"]);
    expect(store.find((a) => a.id === "render-1")!.lifecycle).toBe("ready_for_review");
    expect(fx.jobsTouched).toBe(false);
  });

  it("la cuota/grant no se modifica", async () => {
    const { d, fx } = removeDepsFake();
    await handleRemoveSource(delReq(), d);
    expect(fx.quotaTouched).toBe(false);
  });

  it("tras eliminar, GET /source responde exists:false", async () => {
    const { d } = removeDepsFake();
    await handleRemoveSource(delReq(), d);
    const read = await handleReadSource(req(), d);
    expect(await read.json()).toEqual({ exists: false });
  });

  it("el archivado nunca vuelve a resolverse aunque existan históricos", async () => {
    const { d } = removeDepsFake({}, [
      sourceAsset({ id: "hist-1", lifecycle: "archived", createdAt: "2026-07-01T00:00:00.000Z" }),
      sourceAsset({ id: "hist-2", lifecycle: "archived", createdAt: "2026-07-02T00:00:00.000Z" }),
      sourceAsset({ id: "asset-1", createdAt: "2026-07-03T00:00:00.000Z" }),
    ]);
    await handleRemoveSource(delReq(), d);
    expect(await (await handleReadSource(req(), d)).json()).toEqual({ exists: false });
  });
});

describe("DELETE /source — idempotencia y reemplazo", () => {
  it("un segundo DELETE es seguro: 200, sin 500, sin doble auditoría ni doble borrado", async () => {
    const { d, fx } = removeDepsFake();
    const first = await handleRemoveSource(delReq(), d);
    const second = await handleRemoveSource(delReq(), d);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ removed: false, reason: "no_source" });
    expect(fx.archived).toHaveLength(1);
    expect(fx.deleted).toHaveLength(1);
    expect(fx.audits).toHaveLength(1);
  });

  it("Replace después de Remove funciona: un source nuevo vuelve a ser el vigente", async () => {
    const { d, store } = removeDepsFake();
    await handleRemoveSource(delReq(), d);
    expect(await (await handleReadSource(req(), d)).json()).toEqual({ exists: false });

    store.push(sourceAsset({ id: "asset-2", sourceId: "up-2", createdAt: "2026-08-11T12:00:00.000Z", storagePath: "source/O/L/asset-2/source.mov" }));
    const dto = await (await handleReadSource(req(), d)).json();
    expect(dto.exists).toBe(true);
    expect(dto.source.assetId).toBe("asset-2");
  });

  it("si Storage falla, la eliminación sigue siendo válida (storageDeleted:false, sin 500)", async () => {
    const { d, fx } = removeDepsFake();
    const failing: SourceRemoveDeps = { ...d, removal: { ...d.removal, deleteObject: async () => false } };
    const res = await handleRemoveSource(delReq(), failing);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true, storageDeleted: false });
    expect(fx.audits).toEqual(["asset-1"]);
  });
});

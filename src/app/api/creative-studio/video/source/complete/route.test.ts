import { describe, it, expect, afterEach } from "vitest";
import { handleCompleteSourceUpload, POST, type CompleteSourceDeps } from "./route";
import { buildSourceStoragePath, type StoredObjectMeta } from "@/lib/creative-studio/source-upload";
import type { VideoSourceAuditEntry } from "@/lib/creative-studio/source-audit";
import type { Asset, AssetStore, NewAsset } from "@/lib/assets/types";
import { UniqueViolationError } from "@/lib/assets/asset-store.supabase";

const OWNER = "11111111-1111-1111-1111-111111111111";
const LISTING = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";
const goodPath = buildSourceStoragePath(OWNER, LISTING, ASSET);

function req(body: unknown): Request {
  return new Request("http://x/api/creative-studio/video/source/complete", { method: "POST", body: JSON.stringify(body) });
}

function store(seed: Asset[] = []): AssetStore & { rows: Asset[]; inserts: number } {
  const rows = [...seed];
  let inserts = 0;
  let n = 0;
  return {
    rows,
    get inserts() {
      return inserts;
    },
    async insert(a: NewAsset) {
      // atomic check+push emulating assets_source_unique (source_type, source_id).
      if (rows.some((r) => r.sourceType === a.sourceType && r.sourceId === a.sourceId)) {
        throw new UniqueViolationError("duplicate source");
      }
      inserts += 1;
      const asset: Asset = { ...a, id: `row-${++n}`, createdAt: "2026-07-23T00:00:00Z" };
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

// In-memory audit port emulating the partial unique index (atomic check+push) + a
// configurable number of transient insert failures.
function auditStore(seed: VideoSourceAuditEntry[] = []) {
  const events = [...seed];
  let failNext = 0;
  return {
    events,
    failNextInserts(k: number) {
      failNext = k;
    },
    port: {
      async exists({ userId, listingId, uploadId }: { userId: string; listingId: string; uploadId: string }) {
        return events.some((e) => e.userId === userId && e.listingId === listingId && e.uploadId === uploadId);
      },
      async insert(entry: VideoSourceAuditEntry) {
        if (failNext > 0) {
          failNext -= 1;
          throw new Error("audit db transient");
        }
        if (events.some((e) => e.userId === entry.userId && e.listingId === entry.listingId && e.uploadId === entry.uploadId)) {
          throw new UniqueViolationError("duplicate audit");
        }
        events.push(entry);
      },
    },
  };
}

const OBJ_OK: StoredObjectMeta = { exists: true, sizeBytes: 12_345_678, mimeType: "video/mp4" };

function mkDeps(over: {
  getUser?: CompleteSourceDeps["getUser"];
  loadProperty?: CompleteSourceDeps["loadProperty"];
  assets?: AssetStore;
  statObject?: CompleteSourceDeps["statObject"];
  audit?: ReturnType<typeof auditStore>;
} = {}) {
  const assets = over.assets ?? store();
  const audit = over.audit ?? auditStore();
  const deps: CompleteSourceDeps = {
    getUser: over.getUser ?? (async () => ({ id: OWNER })),
    loadProperty: over.loadProperty ?? (async (id) => ({ id, owner_id: OWNER })),
    checkRateLimit: async () => null,
    assets,
    statObject: over.statObject ?? (async () => OBJ_OK),
    auditPort: audit.port,
  };
  return { deps, assets: assets as AssetStore & { rows: Asset[]; inserts: number }, audit };
}
const body = { listingId: LISTING, assetId: ASSET, storagePath: goodPath };
const existingAsset = (o: Partial<Asset> = {}): Asset => ({
  id: "row-existing", listingId: LISTING, ownerId: OWNER, kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: ASSET,
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: goodPath, checksum: null, bytes: 999, mime: "video/mp4", costUsd: 0,
  costProvider: null, createdBy: OWNER, lifecycle: "draft", qa: null, policy: null, createdAt: "2026-07-23T00:00:00Z", ...o,
});

describe("complete route — auth / ownership / path / object", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("flag OFF → 404", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    expect((await POST(req(body))).status).toBe(404);
  });
  it("unauthenticated → 401", async () => {
    expect((await handleCompleteSourceUpload(req(body), mkDeps({ getUser: async () => null }).deps)).status).toBe(401);
  });
  it("not the owner → 403", async () => {
    expect((await handleCompleteSourceUpload(req(body), mkDeps({ loadProperty: async (id) => ({ id, owner_id: "x" }) }).deps)).status).toBe(403);
  });
  it("path security: other-owner path + traversal → 403", async () => {
    const otherOwnerPath = buildSourceStoragePath("99999999-9999-9999-9999-999999999999", LISTING, ASSET);
    expect((await handleCompleteSourceUpload(req({ ...body, storagePath: otherOwnerPath }), mkDeps().deps)).status).toBe(403);
    expect((await handleCompleteSourceUpload(req({ ...body, storagePath: `source/${OWNER}/${LISTING}/../x/source.mp4` }), mkDeps().deps)).status).toBe(403);
  });
  it("invalid ids → 400", async () => {
    expect((await handleCompleteSourceUpload(req({ ...body, assetId: "nope" }), mkDeps().deps)).status).toBe(400);
  });
  it("object not found → 409; empty/oversized → 400", async () => {
    expect((await handleCompleteSourceUpload(req(body), mkDeps({ statObject: async () => ({ exists: false, sizeBytes: 0, mimeType: null }) }).deps)).status).toBe(409);
    expect((await handleCompleteSourceUpload(req(body), mkDeps({ statObject: async () => ({ exists: true, sizeBytes: 0, mimeType: "video/mp4" }) }).deps)).status).toBe(400);
    expect((await handleCompleteSourceUpload(req(body), mkDeps({ statObject: async () => ({ exists: true, sizeBytes: 400 * 1024 * 1024, mimeType: "video/mp4" }) }).deps)).status).toBe(400);
  });
});

describe("complete route — Source Asset creation", () => {
  it("creates from REAL metadata: kind=video, seller_upload, listing+owner, lifecycle=draft", async () => {
    const { deps, assets } = mkDeps();
    const r = await handleCompleteSourceUpload(req(body), deps);
    expect(r.status).toBe(200);
    const created = assets.rows[0];
    expect(created).toMatchObject({
      kind: "video",
      sourceType: "seller_upload",
      sourceId: ASSET,
      listingId: LISTING,
      ownerId: OWNER,
      storageBucket: "creative-studio",
      storagePath: goodPath,
      bytes: OBJ_OK.sizeBytes, // real stored size, not client
      mime: "video/mp4",
      lifecycle: "draft", // received + available, NOT technically approved
    });
  });
  it("does NOT start preparation/render, creates NO creative job (structural)", async () => {
    const { deps, assets } = mkDeps();
    await handleCompleteSourceUpload(req(body), deps);
    expect(assets.rows.length).toBe(1);
    expect(assets.rows[0].kind).toBe("video");
    expect(assets.rows[0].sourceType).toBe("seller_upload");
  });
  it("reusing an uploadId against a DIFFERENT listing → 409 conflict, no audit", async () => {
    const audit = auditStore();
    const r = await handleCompleteSourceUpload(
      req(body),
      mkDeps({ assets: store([existingAsset({ listingId: "44444444-4444-4444-4444-444444444444" })]), audit }).deps,
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("asset_id_conflict");
    expect(audit.events.length).toBe(0);
  });
  it("storage-missing → NO asset created", async () => {
    const { deps, assets } = mkDeps({ statObject: async () => ({ exists: false, sizeBytes: 0, mimeType: null }) });
    await handleCompleteSourceUpload(req(body), deps);
    expect(assets.rows.length).toBe(0);
  });
});

describe("complete route — idempotent + repairable audit (correction 1)", () => {
  it("1. new asset + audit success → registered:true + one event", async () => {
    const { deps, assets, audit } = mkDeps();
    const r = await handleCompleteSourceUpload(req(body), deps);
    expect(r.status).toBe(200);
    expect((await r.json()).registered).toBe(true);
    expect(assets.rows.length).toBe(1);
    expect(audit.events.length).toBe(1);
  });
  it("2. new asset + audit fails → 503 retryable, asset KEPT, no event, no false success", async () => {
    const audit = auditStore();
    audit.failNextInserts(3);
    const { deps, assets } = mkDeps({ audit });
    const r = await handleCompleteSourceUpload(req(body), deps);
    expect(r.status).toBe(503);
    expect((await r.json())).toMatchObject({ error: "audit_not_ensured", retryable: true });
    expect(assets.rows.length).toBe(1); // asset kept
    expect(audit.events.length).toBe(0);
  });
  it("3. retry after an audit failure REPAIRS the event", async () => {
    const audit = auditStore();
    const assets = store();
    audit.failNextInserts(3);
    const first = await handleCompleteSourceUpload(req(body), mkDeps({ assets, audit }).deps);
    expect(first.status).toBe(503);
    // retry (audit now works): finds the existing asset, ensures the audit, confirms.
    const second = await handleCompleteSourceUpload(req(body), mkDeps({ assets, audit }).deps);
    expect(second.status).toBe(200);
    expect(assets.inserts).toBe(1);
    expect(audit.events.length).toBe(1);
  });
  it("4. normal retry does NOT duplicate the audit", async () => {
    const audit = auditStore();
    const assets = store();
    await handleCompleteSourceUpload(req(body), mkDeps({ assets, audit }).deps);
    await handleCompleteSourceUpload(req(body), mkDeps({ assets, audit }).deps);
    expect(assets.inserts).toBe(1);
    expect(audit.events.length).toBe(1);
  });
  it("5+6. two concurrent completes → ONE asset + ONE event", async () => {
    const audit = auditStore();
    const assets = store();
    const [r1, r2] = await Promise.all([
      handleCompleteSourceUpload(req(body), mkDeps({ assets, audit }).deps),
      handleCompleteSourceUpload(req(body), mkDeps({ assets, audit }).deps),
    ]);
    expect(assets.inserts).toBe(1);
    expect(audit.events.length).toBe(1);
    expect([r1.status, r2.status]).toEqual([200, 200]);
  });
  it("7. existing asset WITHOUT audit → repaired (already_registered + event now present)", async () => {
    const audit = auditStore();
    const r = await handleCompleteSourceUpload(req(body), mkDeps({ assets: store([existingAsset()]), audit }).deps);
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("already_registered");
    expect(audit.events.length).toBe(1);
  });
  it("8. existing asset WITH audit → already_registered, no new event", async () => {
    const audit = auditStore([{ userId: OWNER, listingId: LISTING, uploadId: ASSET, assetId: "row-existing", sizeBytes: 999, mimeType: "video/mp4" }]);
    const r = await handleCompleteSourceUpload(req(body), mkDeps({ assets: store([existingAsset()]), audit }).deps);
    expect((await r.json()).status).toBe("already_registered");
    expect(audit.events.length).toBe(1);
  });
  it("9. asset-create failure → NO audit (never a false success)", async () => {
    const audit = auditStore();
    const failing: AssetStore = { ...store(), insert: async () => { throw new Error("db down"); } };
    const r = await handleCompleteSourceUpload(req(body), mkDeps({ assets: failing, audit }).deps);
    expect(r.status).toBe(500);
    expect(audit.events.length).toBe(0);
  });
  it("10. audit payload contains NO url/token/secret", async () => {
    const audit = auditStore();
    await handleCompleteSourceUpload(req(body), mkDeps({ audit }).deps);
    const serialized = JSON.stringify(audit.events[0]);
    expect(serialized).not.toMatch(/signedUrl|token|sb_secret|https?:\/\//i);
    expect(audit.events[0]).toMatchObject({ listingId: LISTING, uploadId: ASSET, sizeBytes: OBJ_OK.sizeBytes, mimeType: "video/mp4" });
  });
});

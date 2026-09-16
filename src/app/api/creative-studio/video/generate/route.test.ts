import { describe, it, expect, afterEach } from "vitest";
import {
  isCreativeStudioVideoEnabled,
  POST,
  handleGenerateVideo,
  type GenerateVideoDeps,
} from "@/app/api/creative-studio/video/generate/route";
import { UniqueViolationError } from "@/lib/creative-jobs/jobs";
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";
import type { JobTransition } from "@/lib/creative-jobs/states";
import type { Classification } from "@/lib/media-intelligence/types";
import type { Asset } from "@/lib/assets/types";
import { buildIdempotencyKey, hashSourceAssetIds } from "@/lib/video-engine/idempotency";
import { TEMPLATE_VERSION } from "@/lib/video-engine/versions";
import type { VideoAccessResult } from "@/lib/creative-studio/video-access";
import type { ActivityLogPort } from "@/lib/creative-studio/video-access-audit";
import {
  VIDEO_ACCESS_BLOCKED_ACTION,
  VIDEO_QUOTA_CONSUMED_ACTION,
  VIDEO_GENERATION_REQUESTED_ACTION,
} from "@/lib/creative-studio/video-access-audit";

const ACTIVE_STATES = new Set(["queued", "running", "rendering", "uploading", "qa"]);

// In-memory fake JobsStore — same DB-mimicking semantics as
// src/lib/creative-jobs/jobs.test.ts's fake (partial-unique-index-on-active-states,
// no update/delete path for transitions). Duplicated here (not imported from a .test.ts
// file) so this file has no test-to-test coupling.
function fakeJobsStore(): JobsStore & { jobs: CreativeJob[] } {
  const jobs: CreativeJob[] = [];
  const transitions: StoredTransition[] = [];
  let jobSeq = 0;
  let transitionSeq = 0;

  return {
    jobs,

    async insertJob(job) {
      const conflict = jobs.some(
        (j) => j.idempotencyKey === job.idempotencyKey && ACTIVE_STATES.has(j.state),
      );
      if (conflict) {
        throw new UniqueViolationError(`duplicate active idempotency key: ${job.idempotencyKey}`);
      }
      const row: CreativeJob = { ...job, id: `job${++jobSeq}` };
      jobs.push(row);
      return row;
    },

    async getJob(jobId) {
      return jobs.find((j) => j.id === jobId) ?? null;
    },

    async findActiveByIdempotencyKey(key) {
      return jobs.find((j) => j.idempotencyKey === key && ACTIVE_STATES.has(j.state)) ?? null;
    },

    async findLatestByListing(listingId) {
      const matches = jobs
        .filter((j) => j.listingId === listingId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return matches[0] ? { ...matches[0] } : null;
    },

    async findOldestQueued() {
      const queued = jobs
        .filter((j) => j.state === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return queued[0] ? { ...queued[0] } : null;
    },

    async claimQueued(jobId, workerId, nowIso) {
      const row = jobs.find((j) => j.id === jobId);
      if (!row || row.state !== "queued") return null;
      row.state = "running";
      row.claimedAt = nowIso;
      row.claimedBy = workerId;
      row.heartbeatAt = nowIso;
      row.updatedAt = nowIso;
      return { ...row };
    },

    async updateJob(jobId, patch) {
      const row = jobs.find((j) => j.id === jobId);
      if (!row) throw new Error(`no such job: ${jobId}`);
      Object.assign(row, patch);
      return { ...row };
    },

    async appendTransition(transition: JobTransition & { at: string }) {
      const row: StoredTransition = { ...transition, id: `t${++transitionSeq}` };
      transitions.push(row);
      return row;
    },

    async listStaleActive() {
      return [];
    },

    async listJobsByOwner(ownerId) {
      return jobs.filter((j) => j.ownerId === ownerId);
    },

    async listTransitionsByOwner(ownerId) {
      return transitions.filter((t) => t.userId === ownerId);
    },

    async listTransitionsByJob(jobId) {
      return transitions.filter((t) => t.jobId === jobId).sort((a, b) => a.at.localeCompare(b.at));
    },
  };
}

const PROPERTY_ID = "prop-1";
const OWNER_ID = "user-1";
const FIXED_NOW = 1_700_000_000_000;

const READY_CLASSIFICATIONS: Classification[] = [
  { photoId: "photo-1", roomType: "sala", tags: [], confidence: 0.9 },
  { photoId: "photo-2", roomType: "cocina", tags: [], confidence: 0.9 },
  { photoId: "photo-3", roomType: "habitacion", tags: [], confidence: 0.9 },
];

// An allowlisted, in-scope, in-quota access result (grant g1 with 1 of 3 used → 2 remaining).
function allowedAccess(over: Partial<VideoAccessResult> = {}): VideoAccessResult {
  return {
    allowed: true,
    reason: "allowed",
    userAllowed: true,
    listingAllowed: true,
    remainingGenerations: 2,
    consentRequired: false,
    consentSatisfied: true,
    grantId: "g1",
    grantGenerationsUsed: 1,
    ...over,
  };
}

// Records audit calls without touching a DB; every method is best-effort (returns true).
function fakeAudit(): ActivityLogPort & { inserts: Array<{ action_type: string; metadata: Record<string, unknown> }> } {
  const inserts: Array<{ action_type: string; metadata: Record<string, unknown> }> = [];
  return {
    inserts,
    async insert(row) {
      inserts.push({ action_type: row.action_type, metadata: row.metadata });
    },
    async exists() {
      return false;
    },
  };
}

function makeDeps(over: Partial<GenerateVideoDeps> = {}): GenerateVideoDeps {
  return {
    getUser: async () => ({ id: OWNER_ID }),
    loadProperty: async () => ({ id: PROPERTY_ID, owner_id: OWNER_ID, mls_status: "active" }),
    loadPhotos: async () => [
      { id: "photo-1", url: "https://example.com/1.jpg" },
      { id: "photo-2", url: "https://example.com/2.jpg" },
      { id: "photo-3", url: "https://example.com/3.jpg" },
    ],
    classify: async () => READY_CLASSIFICATIONS,
    // Por defecto NO hay Source Video → estrategia photo_slideshow, que es el
    // comportamiento que cubrían todas las pruebas existentes.
    resolveSource: async () => null,
    jobsStore: fakeJobsStore(),
    now: () => FIXED_NOW,
    checkRateLimit: async () => null,
    checkAccess: async () => allowedAccess(),
    consumeQuota: async () => ({ consumed: true, remainingGenerations: 1 }),
    audit: fakeAudit(),
    ...over,
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/creative-studio/video/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("isCreativeStudioVideoEnabled", () => {
  const prev = process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
  afterEach(() => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = prev;
  });
  it("is off unless the env flag is exactly 'true'", () => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = undefined;
    expect(isCreativeStudioVideoEnabled()).toBe(false);
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = "false";
    expect(isCreativeStudioVideoEnabled()).toBe(false);
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = "true";
    expect(isCreativeStudioVideoEnabled()).toBe(true);
  });
});

describe("POST fails closed", () => {
  const prev = process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
  afterEach(() => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = prev;
  });

  it("returns 404 not_found when the flag is unset — before touching Supabase/auth/rate-limit", async () => {
    delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED;
    const res = await POST(req({ property_id: PROPERTY_ID }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns 404 not_found when the flag is 'false'", async () => {
    process.env.CREATIVE_STUDIO_VIDEO_ENABLED = "false";
    const res = await POST(req({ property_id: PROPERTY_ID }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });
});

describe("handleGenerateVideo", () => {
  it("returns 401 when unauthenticated", async () => {
    const deps = makeDeps({ getUser: async () => null });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "not_authenticated" });
  });

  it("returns 403 when the property doesn't exist", async () => {
    const deps = makeDeps({ loadProperty: async () => null });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the authed user isn't the property's owner (even if RLS returns the row, e.g. an active public listing)", async () => {
    const deps = makeDeps({
      loadProperty: async () => ({ id: PROPERTY_ID, owner_id: "someone-else", mls_status: "active" }),
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "property_not_found_or_not_yours" });
  });

  it("returns 422 with structured reasons when video readiness is not_ready", async () => {
    const deps = makeDeps({ classify: async () => [] }); // no interior photos -> not_ready
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; reasons: Array<{ code: string }> };
    expect(json.error).toBe("not_ready");
    expect(json.reasons.map((r) => r.code)).toContain("no_interior_photos");
  });

  it("returns 202 + jobId on success", async () => {
    const deps = makeDeps();
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(202);
    const json = (await res.json()) as { jobId: string };
    expect(typeof json.jobId).toBe("string");
    expect(json.jobId.length).toBeGreaterThan(0);
  });

  it("the 202 response body carries ONLY jobId — no secrets, storage paths, or provider internals", async () => {
    const deps = makeDeps();
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["jobId"]);
  });

  it("a duplicate request returns the SAME jobId and does not create a second job", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({ jobsStore: store });
    const res1 = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    const res2 = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    const json1 = (await res1.json()) as { jobId: string };
    const json2 = (await res2.json()) as { jobId: string };
    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);
    expect(json2.jobId).toBe(json1.jobId);
    expect(store.jobs).toHaveLength(1);
  });

  it("ignores client-supplied ownerId/provider/state/storagePath/idempotencyKey/assetId — server values win", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({ jobsStore: store });
    const res = await handleGenerateVideo(
      req({
        property_id: PROPERTY_ID,
        ownerId: "attacker",
        provider: "evil-provider",
        state: "completed",
        storagePath: "creative-studio/leak/secret.mp4",
        idempotencyKey: "client-supplied-key",
        assetId: "hacked-asset-id",
      }),
      deps,
    );
    expect(res.status).toBe(202);
    expect(store.jobs).toHaveLength(1);
    const job = store.jobs[0]!;
    expect(job.ownerId).toBe(OWNER_ID); // NOT "attacker"
    expect(job.state).toBe("queued"); // NOT "completed"
    expect(job.idempotencyKey).not.toBe("client-supplied-key");

    const expectedKey = buildIdempotencyKey({
      listingId: PROPERTY_ID,
      capability: "video",
      templateVersion: TEMPLATE_VERSION,
      sourceAssetIds: ["photo-1", "photo-2", "photo-3"],
      inputHash: hashSourceAssetIds(["photo-1", "photo-2", "photo-3"]),
    });
    expect(job.idempotencyKey).toBe(expectedKey); // server-derived, deterministic
  });

  it("stamps a non-null traceId on the created job — the durable correlation key crash-recovery reconciles by (Gate D1 exactly-once fix)", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({ jobsStore: store });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(202);
    expect(store.jobs).toHaveLength(1);
    const job = store.jobs[0]!;
    expect(job.traceId).toBeTruthy();
    expect(typeof job.traceId).toBe("string");
  });

  it("a duplicate request keeps the SAME traceId (not a fresh one per call)", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({ jobsStore: store });
    await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(store.jobs).toHaveLength(1);
  });

  it("returns 400 when property_id is missing", async () => {
    const deps = makeDeps();
    const res = await handleGenerateVideo(req({}), deps);
    expect(res.status).toBe(400);
  });

  it("propagates a 429 from the rate limiter before touching ownership/readiness", async () => {
    const deps = makeDeps({
      checkRateLimit: async () => Response.json({ error: "rate_limited" }, { status: 429 }),
      loadProperty: async () => {
        throw new Error("should not be called when rate-limited");
      },
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(429);
  });
});

describe("handleGenerateVideo — Gate 5 access + quota", () => {
  const denied = (reason: VideoAccessResult["reason"], over: Partial<VideoAccessResult> = {}): VideoAccessResult => ({
    allowed: false,
    reason,
    userAllowed: reason !== "no_grant" && reason !== "reader_error",
    listingAllowed: false,
    remainingGenerations: 0,
    consentRequired: false,
    consentSatisfied: false,
    ...over,
  });

  it("non-allowlisted user (no_grant) → 404, NO job created, NO quota consumed, audit records blocked", async () => {
    const store = fakeJobsStore();
    const audit = fakeAudit();
    let consumeCalls = 0;
    const deps = makeDeps({
      jobsStore: store,
      audit,
      checkAccess: async () => denied("no_grant"),
      consumeQuota: async () => {
        consumeCalls++;
        return { consumed: false, remainingGenerations: null };
      },
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(store.jobs).toHaveLength(0);
    expect(consumeCalls).toBe(0);
    expect(audit.inserts.map((i) => i.action_type)).toEqual([VIDEO_ACCESS_BLOCKED_ACTION]);
    expect(audit.inserts[0]!.metadata).toMatchObject({ reason: "no_grant" });
  });

  it("listing out of scope → 404 (feature stays invisible)", async () => {
    const deps = makeDeps({ checkAccess: async () => denied("listing_out_of_scope", { userAllowed: true }) });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(404);
  });

  it("reader error fails closed → 404, no job", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({ jobsStore: store, checkAccess: async () => denied("reader_error") });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(404);
    expect(store.jobs).toHaveLength(0);
  });

  it("quota exhausted → 403 quota_exhausted (distinguishable), NO job created", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({
      jobsStore: store,
      checkAccess: async () => denied("quota_exhausted", { userAllowed: true, listingAllowed: true, grantId: "g1" }),
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "quota_exhausted" });
    expect(store.jobs).toHaveLength(0);
  });

  it("ownership 403 wins BEFORE the access check runs (validation order)", async () => {
    let accessCalled = false;
    const deps = makeDeps({
      loadProperty: async () => ({ id: PROPERTY_ID, owner_id: "someone-else", mls_status: "active" }),
      checkAccess: async () => {
        accessCalled = true;
        return allowedAccess();
      },
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(403);
    expect(accessCalled).toBe(false);
  });

  it("on success: consumes ONE slot with the grant's CAS anchor, and audits requested + consumed", async () => {
    const store = fakeJobsStore();
    const audit = fakeAudit();
    const consumeArgs: Array<{ grantId: string; userId: string; expectedUsed: number }> = [];
    const deps = makeDeps({
      jobsStore: store,
      audit,
      checkAccess: async () => allowedAccess({ grantId: "g1", grantGenerationsUsed: 1 }),
      consumeQuota: async (input) => {
        consumeArgs.push(input);
        return { consumed: true, remainingGenerations: 1 };
      },
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(202);
    expect(consumeArgs).toEqual([{ grantId: "g1", userId: OWNER_ID, expectedUsed: 1 }]);
    const actions = audit.inserts.map((i) => i.action_type);
    expect(actions).toContain(VIDEO_QUOTA_CONSUMED_ACTION);
    expect(actions).toContain(VIDEO_GENERATION_REQUESTED_ACTION);
  });

  it("a duplicate request (created:false) does NOT consume a second slot", async () => {
    const store = fakeJobsStore();
    let consumeCalls = 0;
    const deps = makeDeps({
      jobsStore: store,
      consumeQuota: async () => {
        consumeCalls++;
        return { consumed: true, remainingGenerations: 1 };
      },
    });
    await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps); // created:true → consumes
    await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps); // created:false → must NOT consume
    expect(store.jobs).toHaveLength(1);
    expect(consumeCalls).toBe(1);
  });

  it("a missed CAS at consume time (boundary race) still returns 202 — quota is a safety rail, not a gate", async () => {
    const store = fakeJobsStore();
    const deps = makeDeps({
      jobsStore: store,
      consumeQuota: async () => ({ consumed: false, remainingGenerations: null }),
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(202); // the already-created job proceeds; safe direction
    expect(store.jobs).toHaveLength(1);
  });
});

// ==========================================================================================
// REGRESIÓN DEL INCIDENTE 2026-08-11 + desacoplamiento de readiness por estrategia.
//
// Un vendedor con un Source Video válido no pudo generar porque UNA de sus 11 fotos medía
// 8160×6120 y el clasificador de visión devolvió 400. El fallo escapó como excepción, antes
// de crear el job: sin trace_id, sin evidence pack, y con copy que prometía que reintentar
// funcionaría. Las fotos NO participan en la estrategia uploaded_video.
// ==========================================================================================

const SOURCE_VIDEO: Asset = {
  id: "src-video-1", listingId: PROPERTY_ID, ownerId: OWNER_ID, kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: "up-1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: "source/o/l/up-1/source.mov", checksum: null,
  bytes: 48_412_268, mime: "video/quicktime", costUsd: 0, costProvider: null, createdBy: OWNER_ID,
  lifecycle: "draft", qa: null, policy: null, createdAt: "2026-08-11T21:36:25.922Z",
};

// El error EXACTO que devolvió Anthropic en el incidente.
const OVERSIZED_PHOTO_ERROR = Object.assign(new Error("AI_APICallError"), {
  name: "AI_APICallError",
  statusCode: 400,
  isRetryable: false,
  responseBody:
    '{"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.10.image.source.url: At least one of the image dimensions exceed max allowed size: 8000 pixels"}}',
});

describe("readiness por estrategia — uploaded_video NO depende del clasificador de fotos", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("con Source Video vigente, classifyAssets NUNCA se invoca", async () => {
    let classifyCalls = 0;
    const deps = makeDeps({
      resolveSource: async () => SOURCE_VIDEO,
      classify: async () => { classifyCalls += 1; return READY_CLASSIFICATIONS; },
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(202);
    expect(classifyCalls).toBe(0);
  });

  it("con Source Video vigente, loadPhotos tampoco se invoca (desacoplamiento total)", async () => {
    let photoCalls = 0;
    const deps = makeDeps({
      resolveSource: async () => SOURCE_VIDEO,
      loadPhotos: async () => { photoCalls += 1; return []; },
    });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).status).toBe(202);
    expect(photoCalls).toBe(0);
  });

  it("EL CASO REAL: una foto de 8160×6120 no impide generar cuando hay Source Video", async () => {
    const deps = makeDeps({
      resolveSource: async () => SOURCE_VIDEO,
      classify: async () => { throw OVERSIZED_PHOTO_ERROR; }, // nunca debe alcanzarse
    });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(202);
    expect(await res.json()).toHaveProperty("jobId");
  });

  it("sin interior photos, uploaded_video sigue pudiendo generar", async () => {
    const deps = makeDeps({ resolveSource: async () => SOURCE_VIDEO, classify: async () => [] });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).status).toBe(202);
  });

  it("uploaded_video NO relaja las demás puertas: listing no aprobado sigue bloqueando", async () => {
    const deps = makeDeps({
      resolveSource: async () => SOURCE_VIDEO,
      loadProperty: async () => ({ id: PROPERTY_ID, owner_id: OWNER_ID, mls_status: "draft" }),
    });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).status).toBe(422);
  });

  it("uploaded_video NO relaja ownership ni allowlist", async () => {
    const ajeno = makeDeps({ resolveSource: async () => SOURCE_VIDEO, loadProperty: async () => ({ id: PROPERTY_ID, owner_id: "otro", mls_status: "active" }) });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), ajeno)).status).toBe(403);
    const sinGrant = makeDeps({ resolveSource: async () => SOURCE_VIDEO, checkAccess: async () => ({ ...allowedAccess(), allowed: false, reason: "no_grant", listingAllowed: false }) });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), sinGrant)).status).toBe(404);
  });
});

describe("readiness por estrategia — photo_slideshow conserva sus requisitos", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("sin Source Video, sigue exigiendo interior photos", async () => {
    const deps = makeDeps({ resolveSource: async () => null, classify: async () => [] });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("no_interior_photos");
  });

  it("sin Source Video, con interiores válidos, genera igual que antes", async () => {
    const deps = makeDeps({ resolveSource: async () => null });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).status).toBe(202);
  });

  it("un asset de video INUTILIZABLE (sin storagePath) cae a photo_slideshow", async () => {
    const roto = { ...SOURCE_VIDEO, storagePath: "" };
    let classifyCalls = 0;
    const deps = makeDeps({ resolveSource: async () => roto, classify: async () => { classifyCalls += 1; return READY_CLASSIFICATIONS; } });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).status).toBe(202);
    expect(classifyCalls).toBe(1); // sí clasifica: es la ruta de fotos
  });
});

describe("fallo del clasificador — nunca un 500 sin clasificar", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("foto demasiado grande → 422 determinístico, NO 500, NO retryable", async () => {
    const deps = makeDeps({ resolveSource: async () => null, classify: async () => { throw OVERSIZED_PHOTO_ERROR; } });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.retryable).toBe(false);
    expect(body.error).toBe("not_ready");
  });

  it("proveedor caído (503) → 503 y SÍ retryable", async () => {
    const caido = Object.assign(new Error("upstream"), { name: "AI_APICallError", statusCode: 503, isRetryable: true });
    const deps = makeDeps({ resolveSource: async () => null, classify: async () => { throw caido; } });
    const res = await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(res.status).toBe(503);
    expect((await res.json() as Record<string, unknown>).retryable).toBe(true);
  });

  it("la respuesta NUNCA expone proveedor, modelo, request_id ni stack", async () => {
    const deps = makeDeps({ resolveSource: async () => null, classify: async () => { throw OVERSIZED_PHOTO_ERROR; } });
    const body = JSON.stringify(await (await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).json());
    expect(body).not.toMatch(/anthropic|claude|sonnet|req_|AI_APICallError|responseBody|at Object/i);
  });

  it("toda respuesta de fallo pre-job trae una referencia de 8 hex para soporte", async () => {
    const deps = makeDeps({ resolveSource: async () => null, classify: async () => { throw OVERSIZED_PHOTO_ERROR; } });
    const body = await (await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).json() as Record<string, unknown>;
    // Mismo formato que la referencia de fallo de UX 5C (referenceCodeFromTraceId).
    expect(String(body.reference)).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("cuota — un fallo pre-job jamás la consume", () => {
  afterEach(() => delete process.env.CREATIVE_STUDIO_VIDEO_ENABLED);

  it("readiness fallido (sin interiores) → consumeQuota NO se llama", async () => {
    let consumed = 0;
    const deps = makeDeps({
      resolveSource: async () => null, classify: async () => [],
      consumeQuota: async () => { consumed += 1; return { consumed: true, remainingGenerations: 0 }; },
    });
    await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(consumed).toBe(0);
  });

  it("fallo del proveedor → consumeQuota NO se llama", async () => {
    let consumed = 0;
    const deps = makeDeps({
      resolveSource: async () => null, classify: async () => { throw OVERSIZED_PHOTO_ERROR; },
      consumeQuota: async () => { consumed += 1; return { consumed: true, remainingGenerations: 0 }; },
    });
    await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps);
    expect(consumed).toBe(0);
  });

  it("uploaded_video válido → consume exactamente una vez", async () => {
    let consumed = 0;
    const deps = makeDeps({
      resolveSource: async () => SOURCE_VIDEO,
      consumeQuota: async () => { consumed += 1; return { consumed: true, remainingGenerations: 0 }; },
    });
    expect((await handleGenerateVideo(req({ property_id: PROPERTY_ID }), deps)).status).toBe(202);
    expect(consumed).toBe(1);
  });
});

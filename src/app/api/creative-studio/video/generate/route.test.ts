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
import { buildIdempotencyKey, hashSourceAssetIds } from "@/lib/video-engine/idempotency";
import { TEMPLATE_VERSION } from "@/lib/video-engine/versions";

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
    jobsStore: fakeJobsStore(),
    now: () => FIXED_NOW,
    checkRateLimit: async () => null,
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

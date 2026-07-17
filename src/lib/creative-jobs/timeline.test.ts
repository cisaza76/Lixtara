import { describe, expect, it } from "vitest";
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";
import { getJobTimeline } from "@/lib/creative-jobs/timeline";

function job(overrides: Partial<CreativeJob> = {}): CreativeJob {
  return {
    id: "job-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    capability: "video",
    state: "completed",
    assetId: "video-asset-1",
    idempotencyKey: "idem-1",
    attempts: 0,
    maxAttempts: 3,
    claimedAt: "2026-07-16T00:00:00.000Z",
    claimedBy: "worker-1",
    heartbeatAt: "2026-07-16T00:05:00.000Z",
    cancellationRequested: false,
    timeoutMs: 600_000,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:05:00.000Z",
    traceId: "trace-abc",
    ...overrides,
  };
}

function transition(overrides: Partial<StoredTransition> = {}): StoredTransition {
  return {
    id: "t1",
    jobId: "job-1",
    listingId: "listing-1",
    userId: "owner-1",
    from: "running",
    to: "rendering",
    actor: "worker",
    durationMs: 100,
    costUsd: 0,
    costProvider: null,
    provider: null,
    capability: "video",
    attempt: 1,
    errorCode: null,
    errorMessage: null,
    metadata: {},
    traceId: "trace-abc",
    at: "2026-07-16T00:01:00.000Z",
    ...overrides,
  };
}

function fakeJobsStore(seedJobs: CreativeJob[], seedTransitions: StoredTransition[]): JobsStore {
  return {
    async insertJob() {
      throw new Error("not used by getJobTimeline tests");
    },
    async getJob(jobId) {
      return seedJobs.find((j) => j.id === jobId) ?? null;
    },
    async findActiveByIdempotencyKey() {
      return null;
    },
    async findLatestByListing() {
      return null;
    },
    async findOldestQueued() {
      return null;
    },
    async claimQueued() {
      return null;
    },
    async updateJob() {
      throw new Error("not used by getJobTimeline tests");
    },
    async appendTransition() {
      throw new Error("not used by getJobTimeline tests");
    },
    async listStaleActive() {
      return [];
    },
    async listJobsByOwner(ownerId) {
      return seedJobs.filter((j) => j.ownerId === ownerId);
    },
    async listTransitionsByOwner(ownerId) {
      return seedTransitions.filter((t) => t.userId === ownerId);
    },
    async listTransitionsByJob(jobId) {
      return seedTransitions.filter((t) => t.jobId === jobId).sort((a, b) => a.at.localeCompare(b.at));
    },
  };
}

describe("getJobTimeline", () => {
  it("returns null when the job doesn't exist", async () => {
    const store = fakeJobsStore([], []);
    expect(await getJobTimeline(store, "no-such-job")).toBeNull();
  });

  it("reads transitions job-id-scoped (listTransitionsByJob), never the owner's whole history", async () => {
    const store = fakeJobsStore([job()], [transition({ id: "t1" })]);
    // Sabotage the owner-scoped read — if getJobTimeline ever fell back to it, this
    // test would throw instead of returning a timeline.
    store.listTransitionsByOwner = async () => {
      throw new Error("must not call listTransitionsByOwner");
    };

    const timeline = await getJobTimeline(store, "job-1");

    expect(timeline?.transitions.map((t) => t.id)).toEqual(["t1"]);
  });

  it("returns the job's transitions, ordered oldest -> newest", async () => {
    const store = fakeJobsStore(
      [job()],
      [
        transition({ id: "t3", from: "qa", to: "uploading", at: "2026-07-16T00:03:00.000Z" }),
        transition({ id: "t1", from: "running", to: "rendering", at: "2026-07-16T00:01:00.000Z" }),
        transition({ id: "t2", from: "rendering", to: "qa", at: "2026-07-16T00:02:00.000Z" }),
      ],
    );

    const timeline = await getJobTimeline(store, "job-1");

    expect(timeline?.job.id).toBe("job-1");
    expect(timeline?.transitions.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("excludes another job's transitions even for the same owner", async () => {
    const store = fakeJobsStore(
      [job(), job({ id: "job-2" })],
      [
        transition({ id: "t1", jobId: "job-1" }),
        transition({ id: "t2", jobId: "job-2" }),
      ],
    );

    const timeline = await getJobTimeline(store, "job-1");

    expect(timeline?.transitions.map((t) => t.id)).toEqual(["t1"]);
  });

  it("surfaces the separated RenderMetrics stamped onto the completed transition's metadata", async () => {
    const metrics = {
      sandboxStartupMs: 10,
      assetDownloadMs: 5,
      bundleMs: 5,
      selectCompositionMs: 2,
      renderMs: 100,
      qaMs: 3,
      uploadMs: 20,
      totalMs: 150,
      outputBytes: 1234,
      estimatedCostUsd: 0.01,
    };
    const store = fakeJobsStore(
      [job()],
      [
        transition({
          id: "t4",
          from: "uploading",
          to: "completed",
          at: "2026-07-16T00:04:00.000Z",
          costUsd: 0.01,
          provider: "vercel-sandbox",
          metadata: { metrics },
        }),
      ],
    );

    const timeline = await getJobTimeline(store, "job-1");
    const completed = timeline?.transitions.find((t) => t.to === "completed");

    expect(completed?.metadata.metrics).toEqual(metrics);
    expect(completed?.costUsd).toBe(0.01);
    expect(completed?.provider).toBe("vercel-sandbox");
  });
});

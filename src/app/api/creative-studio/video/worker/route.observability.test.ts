import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreativeJob, JobsStore } from "@/lib/creative-jobs/jobs";
import { runWorker, type RunDeps } from "@/app/api/creative-studio/video/worker/route";

// Issue #112 — the worker run itself becomes observable: one structured summary line
// per invocation, and the previously-SILENT pipeline-bug catch now emits a structured
// error line (while still never crashing the cron run).

function queuedJob(): CreativeJob {
  return {
    id: "job-q1",
    listingId: "listing-1",
    ownerId: "owner-1",
    capability: "video",
    state: "queued",
    assetId: null,
    idempotencyKey: "idem-1",
    attempts: 0,
    maxAttempts: 3,
    claimedAt: null,
    claimedBy: null,
    heartbeatAt: null,
    cancellationRequested: false,
    timeoutMs: 600_000,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(1_700_000_000_000).toISOString(),
    updatedAt: new Date(1_700_000_000_000).toISOString(),
    traceId: "trace-q1",
  };
}

function storeWithOneClaim(): JobsStore {
  let claimed = false;
  const base = queuedJob();
  return {
    async insertJob(j: CreativeJob) {
      return j;
    },
    async getJob() {
      return base;
    },
    async findActiveByIdempotencyKey() {
      return null;
    },
    async findLatestByListing() {
      return null;
    },
    async findOldestQueued() {
      return claimed ? null : base;
    },
    async claimQueued(_jobId: string, workerId: string, nowIso: string) {
      if (claimed) return null;
      claimed = true;
      return { ...base, state: "running", claimedBy: workerId, claimedAt: nowIso };
    },
    async updateJob() {
      return base;
    },
    async appendTransition(t: Record<string, unknown>) {
      return { ...t, id: "t1" };
    },
    async listStaleActive() {
      return [];
    },
    async listJobsByOwner() {
      return [];
    },
    async listTransitionsByOwner() {
      return [];
    },
    async listTransitionsByJob() {
      return [];
    },
  } as unknown as JobsStore;
}

function deps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    jobs: storeWithOneClaim(),
    now: () => Date.now(),
    workerId: "worker-obs-1",
    runJob: async (job) => job,
    recoverAbandoned: async () => [],
    maxJobsPerRun: 1,
    maxConcurrency: 1,
    timeBudgetMs: 5_000,
    staleAfterMs: 120_000,
    ...over,
  };
}

describe("#112 — runWorker structured logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits ONE video_worker_run summary line per invocation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const summary = await runWorker(deps());
    expect(summary).toEqual({ claimed: 1, processed: 1, recovered: 0 });
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("video_worker_run"));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({ event: "video_worker_run", claimed: 1, processed: 1, recovered: 0, workerId: "worker-obs-1" });
    expect(typeof parsed.durationMs).toBe("number");
  });

  it("a pipeline-level throw emits video_worker_internal_error (jobId + sanitized message) and the run survives", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const summary = await runWorker(
      deps({
        runJob: async () => {
          throw new Error("pipeline bug at https://leak.example/signed");
        },
      }),
    );
    expect(summary).toEqual({ claimed: 1, processed: 0, recovered: 0 });
    const lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("video_worker_internal_error"));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.jobId).toBe("job-q1");
    expect(parsed.message).toContain("pipeline bug");
    expect(parsed.message).not.toContain("leak.example");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { GET, POST, runWorker, type RunDeps } from "@/app/api/creative-studio/video/worker/route";
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";
import type { JobTransition } from "@/lib/creative-jobs/states";

// ---- fake JobsStore — same DB-mimicking semantics as jobs.test.ts's fake, so the REAL
// claimNextQueued (imported inside route.ts, not injected) exercises real CAS +
// cancellation-on-claim behavior against it. -----------------------------------------

const ACTIVE_STATES = new Set(["queued", "running", "rendering", "uploading", "qa"]);

function fakeJobsStore(seed: CreativeJob[] = []): JobsStore & { jobs: CreativeJob[]; transitions: StoredTransition[] } {
  const jobs: CreativeJob[] = [...seed];
  const transitions: StoredTransition[] = [];
  let transitionSeq = 0;

  return {
    jobs,
    transitions,
    async insertJob(job) {
      const row: CreativeJob = { ...job, id: `job-${jobs.length + 1}` };
      jobs.push(row);
      return row;
    },
    async getJob(jobId) {
      const row = jobs.find((j) => j.id === jobId);
      return row ? { ...row } : null;
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
    async listStaleActive(staleBeforeIso) {
      return jobs.filter(
        (j) => (j.state === "running" || j.state === "rendering") && (j.heartbeatAt ?? "") < staleBeforeIso,
      );
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

let seq = 0;
function job(overrides: Partial<CreativeJob> = {}): CreativeJob {
  seq++;
  const now = new Date(1_700_000_000_000 + seq).toISOString();
  return {
    id: `seed-${seq}`,
    listingId: "listing-1",
    ownerId: "owner-1",
    capability: "video",
    state: "queued",
    assetId: null,
    idempotencyKey: `idem-${seq}`,
    attempts: 0,
    maxAttempts: 3,
    claimedAt: null,
    claimedBy: null,
    heartbeatAt: null,
    cancellationRequested: false,
    timeoutMs: 600_000,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    traceId: null,
    ...overrides,
  };
}

function baseRunDeps(store: JobsStore, over: Partial<RunDeps> = {}): RunDeps {
  return {
    jobs: store,
    now: () => Date.now(),
    workerId: "worker-test",
    runJob: async (j) => ({ ...j, state: "completed" }),
    recoverAbandoned: async () => [],
    maxJobsPerRun: 1,
    maxConcurrency: 1,
    timeBudgetMs: 60_000,
    staleAfterMs: 120_000,
    ...over,
  };
}

// ---- runWorker: claiming, batch cap, budget, recovery, cancellation ----------------

describe("runWorker", () => {
  it("claims up to maxJobsPerRun and leaves the rest queued", async () => {
    const store = fakeJobsStore([job(), job(), job()]);
    const processedIds: string[] = [];
    const deps = baseRunDeps(store, {
      maxJobsPerRun: 2,
      runJob: async (j) => {
        processedIds.push(j.id);
        return { ...j, state: "completed" };
      },
    });

    const summary = await runWorker(deps);

    expect(summary.claimed).toBe(2);
    expect(summary.processed).toBe(2);
    expect(processedIds).toHaveLength(2);
    expect(store.jobs.filter((j) => j.state === "queued")).toHaveLength(1);
  });

  it("claims nothing and reports zero when the queue is empty", async () => {
    const store = fakeJobsStore([]);
    const summary = await runWorker(baseRunDeps(store, { maxJobsPerRun: 5 }));
    expect(summary).toEqual({ claimed: 0, processed: 0, recovered: 0 });
  });

  it("reports the abandoned-job sweep count via recoverAbandoned", async () => {
    const store = fakeJobsStore([]);
    const recoveredJob = job({ id: "stale-1", state: "queued" });
    const deps = baseRunDeps(store, { recoverAbandoned: async () => [recoveredJob] });

    const summary = await runWorker(deps);

    expect(summary.recovered).toBe(1);
  });

  it("honors cancellation_requested — a cancelled queued job is claimed-to-cancelled but never processed", async () => {
    const store = fakeJobsStore([job({ cancellationRequested: true })]);
    const processedIds: string[] = [];
    const deps = baseRunDeps(store, {
      maxJobsPerRun: 5,
      runJob: async (j) => {
        processedIds.push(j.id);
        return { ...j, state: "completed" };
      },
    });

    const summary = await runWorker(deps);

    expect(processedIds).toHaveLength(0);
    expect(summary.claimed).toBe(0);
    expect(summary.processed).toBe(0);
    expect(store.jobs[0]?.state).toBe("cancelled");
  });

  it("does not starve a queued job behind a cancelled/raced head — a null claim retries instead of ending the run", async () => {
    // Oldest job is cancellation-flagged (claimNextQueued transitions it straight to
    // 'cancelled' and returns null for it — NOT "queue empty"). A second, genuinely
    // queued job sits right behind it and must still get claimed/processed.
    const cancelledHead = job({ cancellationRequested: true });
    const behindIt = job();
    const store = fakeJobsStore([cancelledHead, behindIt]);
    const processedIds: string[] = [];
    const deps = baseRunDeps(store, {
      maxJobsPerRun: 5,
      runJob: async (j) => {
        processedIds.push(j.id);
        return { ...j, state: "completed" };
      },
    });

    const summary = await runWorker(deps);

    expect(processedIds).toEqual([behindIt.id]);
    expect(summary.claimed).toBe(1);
    expect(summary.processed).toBe(1);
    expect(store.jobs.find((j) => j.id === cancelledHead.id)?.state).toBe("cancelled");
    // Claimed (CAS'd to 'running') and handed to runJob — this fake's runJob doesn't
    // persist its returned 'completed' state back to the store, so 'running' here is
    // proof the job WAS claimed/dispatched (see processedIds above for the outcome).
    expect(store.jobs.find((j) => j.id === behindIt.id)?.state).toBe("running");
  });

  it("a fully empty queue still terminates without spinning (bounded by the consecutive-null cap, not maxJobsPerRun)", async () => {
    const store = fakeJobsStore([]);
    let claimAttempts = 0;
    const originalFindOldestQueued = store.findOldestQueued.bind(store);
    store.findOldestQueued = async () => {
      claimAttempts++;
      return originalFindOldestQueued();
    };

    const summary = await runWorker(baseRunDeps(store, { maxJobsPerRun: 1000 }));

    expect(summary).toEqual({ claimed: 0, processed: 0, recovered: 0 });
    // Bounded by the small consecutive-null cap, nowhere near maxJobsPerRun — proves the
    // "continue instead of break" change did not turn this into an unbounded spin.
    expect(claimAttempts).toBeLessThanOrEqual(5);
  });

  it("stops CLAIMING once the time budget is exhausted, leaving eligible jobs queued", async () => {
    const store = fakeJobsStore([job(), job(), job()]);
    let calls = 0;
    const deps = baseRunDeps(store, {
      maxJobsPerRun: 5,
      timeBudgetMs: 10,
      now: () => {
        calls++;
        // First call establishes `startMs`; every call after that reports the budget
        // as already exhausted, so the claim loop must stop before ever calling
        // claimNextQueued.
        return calls === 1 ? 0 : 1000;
      },
    });

    const summary = await runWorker(deps);

    expect(summary.claimed).toBe(0);
    expect(store.jobs.filter((j) => j.state === "queued")).toHaveLength(3);
  });

  it("respects maxConcurrency — never runs more than N jobs at once", async () => {
    const store = fakeJobsStore([job(), job(), job()]);
    let inFlight = 0;
    let maxSeen = 0;
    const deps = baseRunDeps(store, {
      maxJobsPerRun: 3,
      maxConcurrency: 1,
      runJob: async (j) => {
        inFlight++;
        maxSeen = Math.max(maxSeen, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return { ...j, state: "completed" };
      },
    });

    await runWorker(deps);

    expect(maxSeen).toBe(1);
  });

  it("swallows a runJob rejection (pipeline bug) without crashing the run", async () => {
    const store = fakeJobsStore([job()]);
    const deps = baseRunDeps(store, {
      runJob: async () => {
        throw new Error("pipeline bug — should never surface to the response");
      },
    });

    const summary = await runWorker(deps);

    expect(summary.claimed).toBe(1);
    expect(summary.processed).toBe(0); // rejected, not counted as processed
  });
});

// ---- HTTP secret gate (POST/GET) ---------------------------------------------------

describe("worker route — CRON_SECRET gate", () => {
  const prevSecret = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = prevSecret;
  });

  function req(headers?: Record<string, string>) {
    return new Request("http://localhost/api/creative-studio/video/worker", {
      method: "POST",
      headers,
    });
  }

  it("401s when CRON_SECRET is unconfigured — fails closed, never 'open' by omission", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("401s with no Authorization header even when CRON_SECRET is set", async () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple";
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("401s with a wrong secret of the SAME length as configured", async () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple";
    const res = await POST(req({ authorization: "Bearer wrong-horse-battery-staple" }));
    expect(res.status).toBe(401);
  });

  it("401s with a secret of a DIFFERENT length than configured (no crash from timingSafeEqual)", async () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple";
    const res = await POST(req({ authorization: "Bearer short" }));
    expect(res.status).toBe(401);
  });

  it("the 401 body never distinguishes missing vs wrong vs unconfigured — no leaked reason", async () => {
    process.env.CRON_SECRET = "correct-horse-battery-staple";
    const wrongSecretRes = await POST(req({ authorization: "Bearer nope" }));
    delete process.env.CRON_SECRET;
    const unconfiguredRes = await POST(req());
    expect(await wrongSecretRes.json()).toEqual(await unconfiguredRes.json());
  });

  it("never returns a stack trace in the 401 body", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req());
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // typical Node stack-frame shape
    expect(text).not.toContain("node_modules");
  });

  it("GET is wired to the identical guarded handler as POST", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request("http://localhost/api/creative-studio/video/worker"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });
});

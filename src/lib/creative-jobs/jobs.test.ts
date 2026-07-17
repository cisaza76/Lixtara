import { describe, it, expect } from "vitest";
import {
  createJob,
  claimNextQueued,
  setState,
  recoverAbandoned,
  requestCancel,
  appendTransition,
  listJobsForOwner,
  listTransitionsForOwner,
  UniqueViolationError,
} from "@/lib/creative-jobs/jobs";
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";
import type { JobTransition } from "@/lib/creative-jobs/states";

// In-memory fake JobsStore that mimics the real DB semantics: `claimQueued` performs a
// genuine compare-and-set against the row's CURRENT state (not a caller-held snapshot),
// `findActiveByIdempotencyKey` enforces the same rule as the partial unique index
// `creative_jobs_idempotency_active` (supabase/migrations/
// 20260715171914_creative_studio_video.sql), and `appendTransition` is the only write
// path for transitions — there is no update/delete method on the interface at all.
const ACTIVE_STATES = new Set(["queued", "running", "rendering", "uploading", "qa"]);

function fakeStore(): JobsStore & { jobs: CreativeJob[]; transitions: StoredTransition[] } {
  const jobs: CreativeJob[] = [];
  const transitions: StoredTransition[] = [];
  let jobSeq = 0;
  let transitionSeq = 0;

  return {
    jobs,
    transitions,

    async insertJob(job) {
      // Mirrors the partial unique index `creative_jobs_idempotency_active`: reject an
      // insert whose idempotency_key collides with an existing ACTIVE-state row, the
      // same way Postgres would reject it with a unique_violation (SQLSTATE 23505).
      const conflict = jobs.some(
        (j) => j.idempotencyKey === job.idempotencyKey && ACTIVE_STATES.has(j.state),
      );
      if (conflict) {
        throw new UniqueViolationError(
          `duplicate active idempotency key: ${job.idempotencyKey}`,
        );
      }
      const row: CreativeJob = { ...job, id: `job${++jobSeq}` };
      jobs.push(row);
      return row;
    },

    async getJob(jobId) {
      return jobs.find((j) => j.id === jobId) ?? null;
    },

    async findActiveByIdempotencyKey(key) {
      return (
        jobs.find((j) => j.idempotencyKey === key && ACTIVE_STATES.has(j.state)) ?? null
      );
    },

    async findLatestByListing(listingId) {
      const matches = jobs
        .filter((j) => j.listingId === listingId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return matches[0] ? { ...matches[0] } : null; // snapshot copy — not the live row
    },

    async findOldestQueued() {
      const queued = jobs
        .filter((j) => j.state === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return queued[0] ? { ...queued[0] } : null; // snapshot copy — not the live row
    },

    async claimQueued(jobId, workerId, nowIso) {
      // Live lookup by id, live state check: the compare-and-set. A caller holding a
      // stale snapshot (from findOldestQueued) cannot bypass this.
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
      const STALE_CANDIDATE_STATES = new Set(["running", "rendering", "uploading", "qa"]);
      return jobs
        .filter(
          (j) =>
            STALE_CANDIDATE_STATES.has(j.state) &&
            j.heartbeatAt !== null &&
            j.heartbeatAt < staleBeforeIso,
        )
        .map((j) => ({ ...j })); // snapshot copies — a real SELECT wouldn't hand back live rows
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

const baseInput = {
  listingId: "L1",
  ownerId: "O1",
  capability: "video",
  idempotencyKey: "L1:tmplv1:hash1",
};

describe("createJob", () => {
  it("inserts a new job in state 'queued'", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });
    expect(job.state).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(store.jobs).toHaveLength(1);
  });

  it("duplicate createJob with the same idempotency key returns the same job, no second row", async () => {
    const store = fakeStore();
    const first = await createJob(store, { ...baseInput, nowMs: 0 });
    const second = await createJob(store, { ...baseInput, nowMs: 100 });
    expect(second.id).toBe(first.id);
    expect(store.jobs).toHaveLength(1);
  });

  it("allows a new job once the previous one with the same key reached a terminal state", async () => {
    const store = fakeStore();
    const first = await createJob(store, { ...baseInput, nowMs: 0 });
    await setState(store, first.id, "cancelled", { actor: "seller", nowMs: 10 });

    const second = await createJob(store, { ...baseInput, nowMs: 20 });
    expect(second.id).not.toBe(first.id);
    expect(store.jobs).toHaveLength(2);
  });

  it("stores an optional traceId (default null when omitted)", async () => {
    const store = fakeStore();
    const withTrace = await createJob(store, { ...baseInput, nowMs: 0, traceId: "trace-abc" });
    expect(withTrace.traceId).toBe("trace-abc");

    const withoutTrace = await createJob(store, {
      ...baseInput,
      idempotencyKey: "L1:tmplv1:hash2",
      nowMs: 0,
    });
    expect(withoutTrace.traceId).toBeNull();
  });

  it("CONCURRENCY: two createJob calls with the same idempotency key race the insert — exactly one row, both resolve to the same job", async () => {
    // Against the OLD read-then-write code (no catch around insertJob), this would
    // fail: both calls pass `findActiveByIdempotencyKey` before either has inserted
    // (classic check-then-act race), so both call `insertJob`. With the fake store's
    // insertJob now throwing a unique-violation-style error on a colliding active key
    // (mirroring the real partial unique index `creative_jobs_idempotency_active`),
    // the losing insert would throw and `Promise.all` would reject the whole race.
    // The fix (catch the unique violation, re-query, return the winner's row) is what
    // makes both calls resolve instead of one of them rejecting.
    const store = fakeStore();

    const [a, b] = await Promise.all([
      createJob(store, { ...baseInput, nowMs: 0 }),
      createJob(store, { ...baseInput, nowMs: 0 }),
    ]);

    expect(store.jobs).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(a).toEqual(b);
  });
});

describe("setState", () => {
  it("rejects an invalid transition (queued -> completed throws)", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });
    await expect(
      setState(store, job.id, "completed", { actor: "system", nowMs: 10 }),
    ).rejects.toThrow();
    expect(store.transitions).toHaveLength(0);
  });

  it("applies a legal transition, bumps updated_at, refreshes heartbeat_at, and appends a transition", async () => {
    const store = fakeStore();
    await createJob(store, { ...baseInput, nowMs: 0 });
    const claimed = await claimNextQueued(store, "w1", { nowMs: 100 });
    const updated = await setState(store, claimed!.id, "rendering", {
      actor: "worker",
      nowMs: 500,
      provider: "remotion",
      capability: "video",
    });

    expect(updated.state).toBe("rendering");
    expect(updated.updatedAt).toBe(new Date(500).toISOString());
    expect(updated.heartbeatAt).toBe(new Date(500).toISOString());

    const last = store.transitions.at(-1)!;
    expect(last.from).toBe("running");
    expect(last.to).toBe("rendering");
    expect(last.durationMs).toBe(400); // 500 - 100 (when it entered 'running')
    expect(last.provider).toBe("remotion");
    expect(last.actor).toBe("worker"); // the actor setState's caller supplied in meta
  });

  it("sets a structured error_code on -> failed", async () => {
    const store = fakeStore();
    await createJob(store, { ...baseInput, nowMs: 0 });
    const claimed = await claimNextQueued(store, "w1", { nowMs: 0 });
    const failed = await setState(store, claimed!.id, "failed", {
      actor: "worker",
      nowMs: 50,
      error: { code: "render_timeout", message: "sandbox exceeded ceiling" },
    });

    expect(failed.state).toBe("failed");
    expect(failed.errorCode).toBe("render_timeout");
    expect(failed.errorMessage).toBe("sandbox exceeded ceiling");
    const last = store.transitions.at(-1)!;
    expect(last.errorCode).toBe("render_timeout");
  });

  it("a transition inherits its job's traceId", async () => {
    const store = fakeStore();
    await createJob(store, { ...baseInput, nowMs: 0, traceId: "trace-xyz" });
    const claimed = await claimNextQueued(store, "w1", { nowMs: 10 });
    const updated = await setState(store, claimed!.id, "rendering", {
      actor: "worker",
      nowMs: 20,
    });

    expect(updated.traceId).toBe("trace-xyz");
    const last = store.transitions.at(-1)!;
    expect(last.traceId).toBe("trace-xyz");
  });
});

describe("claimNextQueued — atomic claim", () => {
  it("claims the oldest queued job, sets claimed_at/claimed_by, and logs the transition", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });
    const claimed = await claimNextQueued(store, "worker-1", { nowMs: 42 });

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.state).toBe("running");
    expect(claimed!.claimedBy).toBe("worker-1");
    expect(claimed!.claimedAt).toBe(new Date(42).toISOString());

    const last = store.transitions.at(-1)!;
    expect(last.from).toBe("queued");
    expect(last.to).toBe("running");
    expect(last.actor).toBe("worker");
    expect(last.attempt).toBe(job.attempts + 1); // reclaimed jobs log the right attempt number
  });

  it("returns null when there is no queued job", async () => {
    const store = fakeStore();
    const result = await claimNextQueued(store, "worker-1", { nowMs: 0 });
    expect(result).toBeNull();
  });

  it("two concurrent claimers racing for the same job — exactly one wins, the other gets null", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });

    const [a, b] = await Promise.all([
      claimNextQueued(store, "worker-a", { nowMs: 10 }),
      claimNextQueued(store, "worker-b", { nowMs: 10 }),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(job.id);

    // Exactly one 'running' transition was logged for this job — the loser never
    // appended one.
    const runningTransitions = store.transitions.filter(
      (t) => t.jobId === job.id && t.to === "running",
    );
    expect(runningTransitions).toHaveLength(1);

    // The job row itself is claimed exactly once — not double-claimed by both.
    const row = store.jobs.find((j) => j.id === job.id)!;
    expect(row.state).toBe("running");
  });
});

describe("recoverAbandoned", () => {
  it("re-queues a stale running job when attempts < max_attempts, incrementing attempts", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0, maxAttempts: 3 });
    await claimNextQueued(store, "w1", { nowMs: 0 }); // heartbeat_at = 0

    const recovered = await recoverAbandoned(store, /* now */ 100_000, /* staleMs */ 60_000);

    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe(job.id);
    expect(recovered[0].state).toBe("queued");
    expect(recovered[0].attempts).toBe(1);

    const last = store.transitions.at(-1)!;
    expect(last.from).toBe("running");
    expect(last.to).toBe("queued");
    expect(last.metadata).toMatchObject({ reason: "heartbeat_stale" });
    expect(last.actor).toBe("system"); // supervisory reset, never a worker/seller action
  });

  // Gate C2 fix: a worker can die mid-upload or mid-QA exactly as easily as
  // mid-render — recovery must not be limited to running/rendering, or a job stuck in
  // one of these two states is stranded forever with no path back to queued.
  it.each(["uploading", "qa"] as const)(
    "re-queues a stale '%s' job when attempts < max_attempts, incrementing attempts (supervisory transition, bypasses canTransition)",
    async (staleState) => {
      const store = fakeStore();
      const job = await createJob(store, { ...baseInput, nowMs: 0, maxAttempts: 3 });
      await claimNextQueued(store, "w1", { nowMs: 0 }); // heartbeat_at = 0
      // Force the job into the stale active state under test — `${staleState} -> queued`
      // is NOT a legal edge in LEGAL_TRANSITIONS (mirrors production: only
      // recoverAbandoned's supervisory path can make this move, never `setState`), so
      // this fixture setup bypasses setState/canTransition directly, exactly like the
      // real worker's own `rendering -> qa -> uploading` progression would leave it.
      await store.updateJob(job.id, { state: staleState, heartbeatAt: new Date(0).toISOString() });

      const recovered = await recoverAbandoned(store, /* now */ 100_000, /* staleMs */ 60_000);

      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe(job.id);
      expect(recovered[0].state).toBe("queued");
      expect(recovered[0].attempts).toBe(1);

      const last = store.transitions.at(-1)!;
      expect(last.from).toBe(staleState);
      expect(last.to).toBe("queued");
      expect(last.metadata).toMatchObject({ reason: "heartbeat_stale", requeued: true });
      expect(last.actor).toBe("system"); // supervisory reset, never a worker/seller action
    },
  );

  it.each(["uploading", "qa"] as const)(
    "fails a stale '%s' job past max_attempts with error_code 'timeout'",
    async (staleState) => {
      const store = fakeStore();
      const job = await createJob(store, { ...baseInput, nowMs: 0, maxAttempts: 1 });
      await claimNextQueued(store, "w1", { nowMs: 0 });
      await store.updateJob(job.id, {
        state: staleState,
        attempts: 1, // already at max_attempts
        heartbeatAt: new Date(0).toISOString(),
      });

      const recovered = await recoverAbandoned(store, 100_000, 60_000);

      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe(job.id);
      expect(recovered[0].state).toBe("failed");
      expect(recovered[0].errorCode).toBe("timeout");

      const last = store.transitions.at(-1)!;
      expect(last.from).toBe(staleState);
      expect(last.to).toBe("failed");
      expect(last.errorCode).toBe("timeout");
      expect(last.actor).toBe("system");
    },
  );

  // A job requeued out of a stale 'uploading'/'qa' state is, by construction, one whose
  // prior attempt may already have uploaded/persisted an Asset. That's exactly what
  // `processJob`'s retry-reconciliation step (src/lib/video-engine/pipeline.ts,
  // `deps.reconcile`) exists to guard: it runs BEFORE any render/upload work on the
  // retried attempt and, matched on the job's idempotency key/traceId, adopts a prior
  // attempt's Asset instead of re-uploading — see pipeline.test.ts's "retry
  // reconciliation" suite for the full round trip (recovered job -> reclaimed -> no
  // duplicate produce()/Asset call).
  it("a job recovered from a stale 'uploading' state is reclaimable and re-enters 'running' cleanly (no leftover claim/heartbeat state)", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0, maxAttempts: 3 });
    await claimNextQueued(store, "w1", { nowMs: 0 });
    await store.updateJob(job.id, { state: "uploading", heartbeatAt: new Date(0).toISOString() });

    await recoverAbandoned(store, 100_000, 60_000);
    const reclaimed = await claimNextQueued(store, "w2", { nowMs: 100_000 });

    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe(job.id);
    expect(reclaimed!.state).toBe("running");
    expect(reclaimed!.attempts).toBe(1);
    expect(reclaimed!.claimedBy).toBe("w2");
  });

  it("fails a stale job past max_attempts with error_code 'timeout'", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0, maxAttempts: 1 });
    await claimNextQueued(store, "w1", { nowMs: 0 }); // attempts still 0, heartbeat_at = 0

    // First recovery: attempts(0) < maxAttempts(1) -> requeue, attempts becomes 1.
    await recoverAbandoned(store, 100_000, 60_000);
    // Re-claim and let it go stale again.
    await claimNextQueued(store, "w2", { nowMs: 100_000 });

    // Second recovery: attempts(1) is no longer < maxAttempts(1) -> fail.
    const recovered = await recoverAbandoned(store, 200_000, 60_000);

    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe(job.id);
    expect(recovered[0].state).toBe("failed");
    expect(recovered[0].errorCode).toBe("timeout");

    const last = store.transitions.at(-1)!;
    expect(last.from).toBe("running");
    expect(last.to).toBe("failed");
    expect(last.errorCode).toBe("timeout");
    expect(last.actor).toBe("system"); // supervisory reset, never a worker/seller action
  });

  it("leaves fresh (non-stale) active jobs untouched", async () => {
    const store = fakeStore();
    await createJob(store, { ...baseInput, nowMs: 0 });
    await claimNextQueued(store, "w1", { nowMs: 100_000 }); // heartbeat_at = 100_000, fresh

    const recovered = await recoverAbandoned(store, 100_000 + 1000, 60_000);
    expect(recovered).toHaveLength(0);
  });
});

describe("requestCancel", () => {
  it("marks cancellation_requested, and a later claim honors it instead of handing out work", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });

    const marked = await requestCancel(store, job.id);
    expect(marked.cancellationRequested).toBe(true);

    const claimed = await claimNextQueued(store, "worker-1", { nowMs: 10 });
    expect(claimed).toBeNull(); // never handed to a worker

    const row = store.jobs.find((j) => j.id === job.id)!;
    expect(row.state).toBe("cancelled");

    // The CAS claim wins first (queued -> running), then the now-uncontested job is
    // transitioned running -> cancelled — only ONE transition is ever appended.
    const last = store.transitions.at(-1)!;
    expect(last.from).toBe("running");
    expect(last.to).toBe("cancelled");
    expect(last.actor).toBe("system");
    expect(store.transitions.filter((t) => t.jobId === job.id)).toHaveLength(1);
  });

  it("CONCURRENCY: two claimers racing a still-queued, cancellation-flagged job produce exactly one → cancelled transition", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });
    await requestCancel(store, job.id);

    const [a, b] = await Promise.all([
      claimNextQueued(store, "worker-a", { nowMs: 10 }),
      claimNextQueued(store, "worker-b", { nowMs: 10 }),
    ]);

    // Neither caller gets a job to work on — it was cancelled, not claimed.
    expect(a).toBeNull();
    expect(b).toBeNull();

    const row = store.jobs.find((j) => j.id === job.id)!;
    expect(row.state).toBe("cancelled");

    // Exactly one → cancelled transition was appended for this job. Against the old
    // read-then-write short-circuit (both callers read cancellationRequested off a
    // stale snapshot before either wrote), this assertion fails with 2 rows — the CAS
    // claim must run first so only the uncontested winner ever builds a transition.
    const cancelledTransitions = store.transitions.filter(
      (t) => t.jobId === job.id && t.to === "cancelled",
    );
    expect(cancelledTransitions).toHaveLength(1);
    expect(cancelledTransitions[0]!.actor).toBe("system");
  });
});

describe("appendTransition — append-only", () => {
  it("every call inserts a new row; prior rows are never mutated", async () => {
    const store = fakeStore();
    const job = await createJob(store, { ...baseInput, nowMs: 0 });

    const t1: JobTransition = {
      jobId: job.id,
      listingId: job.listingId,
      userId: job.ownerId,
      from: "queued",
      to: "running",
      actor: "worker",
      durationMs: 5,
      costUsd: 0,
      costProvider: null,
      provider: null,
      capability: null,
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      metadata: {},
    };
    const stored1 = await appendTransition(store, t1, "1970-01-01T00:00:00.001Z");
    const stored2 = await appendTransition(store, t1, "1970-01-01T00:00:00.002Z");

    expect(store.transitions).toHaveLength(2);
    expect(stored1.id).not.toBe(stored2.id);
    // The JobsStore interface has no update/delete method for transitions at all —
    // this is structural (see the type), asserted here at runtime too: the first row
    // is byte-identical to what was written.
    expect(store.transitions[0]).toEqual(stored1);
  });
});

describe("owner isolation", () => {
  it("listJobsForOwner returns only that owner's jobs", async () => {
    const store = fakeStore();
    const jobA = await createJob(store, { ...baseInput, ownerId: "ownerA", nowMs: 0 });
    await createJob(store, {
      ...baseInput,
      ownerId: "ownerB",
      idempotencyKey: "L1:tmplv1:hash2",
      nowMs: 0,
    });

    const forA = await listJobsForOwner(store, "ownerA");
    expect(forA).toHaveLength(1);
    expect(forA[0].id).toBe(jobA.id);
  });

  it("listTransitionsForOwner returns only that owner's transitions", async () => {
    const store = fakeStore();
    await createJob(store, { ...baseInput, ownerId: "ownerA", nowMs: 0 });
    const jobB = await createJob(store, {
      ...baseInput,
      ownerId: "ownerB",
      idempotencyKey: "L1:tmplv1:hash2",
      nowMs: 0,
    });
    await claimNextQueued(store, "w1", { nowMs: 10 }); // claims oldest queued (jobA)
    // Claim jobB explicitly by forcing it to be the only queued job left.
    await claimNextQueued(store, "w2", { nowMs: 10 });

    const forA = await listTransitionsForOwner(store, "ownerA");
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every((t) => t.userId === "ownerA")).toBe(true);
    expect(forA.some((t) => t.jobId === jobB.id)).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { SupabaseJobsStore } from "@/lib/creative-jobs/jobs-store.supabase";
import { createJob, claimNextQueued, UniqueViolationError } from "@/lib/creative-jobs/jobs";

// Minimal hand-written fake of the Postgrest query-builder chain SupabaseJobsStore
// calls: eq/in/lt/order/limit/select return the SAME builder (chainable) which is ALSO
// directly awaitable (mirrors the real @supabase/supabase-js builder) and exposes a
// terminal `.maybeSingle()`. No network — `result` is the canned `{data, error}` this
// builder always resolves to. `calls` records every chain step so tests can assert on
// the exact filters a method applied (the CAS test needs this).
function makeBuilder(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder = {
    eq: vi.fn((...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return builder;
    }),
    in: vi.fn((...args: unknown[]) => {
      calls.push({ method: "in", args });
      return builder;
    }),
    lt: vi.fn((...args: unknown[]) => {
      calls.push({ method: "lt", args });
      return builder;
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.push({ method: "order", args });
      return builder;
    }),
    limit: vi.fn((...args: unknown[]) => {
      calls.push({ method: "limit", args });
      return builder;
    }),
    select: vi.fn((...args: unknown[]) => {
      calls.push({ method: "select", args });
      return builder;
    }),
    maybeSingle: vi.fn(async () => result),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { builder, calls };
}

// A `from(table)` stub whose insert/update/select each resolve to their OWN canned
// result (a single client instance, unlike the AssetStore test's single-shot fake,
// because the createJob/claimNextQueued integration tests below issue more than one
// distinct call — e.g. insert THEN a re-query select — against the same store).
function fakeClient(opts: {
  insertResult?: { data: unknown; error: unknown };
  selectResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
}) {
  const insertCalls: Array<{ table: string; row: unknown }> = [];
  const updateCalls: Array<{ table: string; patch: unknown; calls: Array<{ method: string; args: unknown[] }> }> = [];
  const selectCalls: Array<{ table: string; calls: Array<{ method: string; args: unknown[] }> }> = [];

  const from = vi.fn((table: string) => ({
    insert: vi.fn((row: unknown) => {
      insertCalls.push({ table, row });
      return makeBuilder(opts.insertResult ?? { data: null, error: null }).builder;
    }),
    update: vi.fn((patch: unknown) => {
      const { builder, calls } = makeBuilder(opts.updateResult ?? { data: [], error: null });
      updateCalls.push({ table, patch, calls });
      return builder;
    }),
    select: vi.fn((...args: unknown[]) => {
      const { builder, calls } = makeBuilder(opts.selectResult ?? { data: null, error: null });
      calls.push({ method: "select", args });
      selectCalls.push({ table, calls });
      return builder;
    }),
  }));

  return { from, insertCalls, updateCalls, selectCalls };
}

const jobRow = {
  id: "job1",
  listing_id: "L1",
  owner_id: "O1",
  capability: "video",
  state: "queued",
  asset_id: null,
  idempotency_key: "L1:tmplv1:hash1",
  attempts: 0,
  max_attempts: 3,
  claimed_at: null,
  claimed_by: null,
  heartbeat_at: null,
  cancellation_requested: false,
  timeout_ms: 600000,
  error_code: null,
  error_message: null,
  trace_id: null,
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
};

const baseJob = {
  listingId: "L1",
  ownerId: "O1",
  capability: "video",
  state: "queued" as const,
  assetId: null,
  idempotencyKey: "L1:tmplv1:hash1",
  attempts: 0,
  maxAttempts: 3,
  claimedAt: null,
  claimedBy: null,
  heartbeatAt: null,
  cancellationRequested: false,
  timeoutMs: 600000,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  traceId: null,
};

describe("SupabaseJobsStore.insertJob", () => {
  it("maps camelCase job to the snake_case creative_jobs row on write and back on read", async () => {
    const { from, insertCalls } = fakeClient({ insertResult: { data: jobRow, error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    const job = await store.insertJob(baseJob);
    expect(insertCalls[0].row).toMatchObject({
      listing_id: "L1",
      owner_id: "O1",
      idempotency_key: "L1:tmplv1:hash1",
      state: "queued",
      max_attempts: 3,
    });
    expect(job).toEqual({ id: "job1", ...baseJob });
  });

  it("surfaces a 23505 unique violation as UniqueViolationError (jobs.ts#createJob catches this)", async () => {
    const { from } = fakeClient({
      insertResult: { data: null, error: { code: "23505", message: "duplicate active idempotency key" } },
    });
    const store = new SupabaseJobsStore({ from } as never);
    await expect(store.insertJob(baseJob)).rejects.toThrow(UniqueViolationError);
  });
});

describe("SupabaseJobsStore.getJob / findActiveByIdempotencyKey / findOldestQueued", () => {
  it("getJob filters by id and maps the row back; null when missing", async () => {
    const { from, selectCalls } = fakeClient({ selectResult: { data: jobRow, error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    const job = await store.getJob("job1");
    expect(selectCalls[0].calls).toEqual(
      expect.arrayContaining([{ method: "eq", args: ["id", "job1"] }]),
    );
    expect(job?.id).toBe("job1");

    const missing = fakeClient({ selectResult: { data: null, error: null } });
    const missingStore = new SupabaseJobsStore({ from: missing.from } as never);
    expect(await missingStore.getJob("nope")).toBeNull();
  });

  it("findActiveByIdempotencyKey filters by idempotency_key AND state IN the active set (includes 'queued')", async () => {
    const { from, selectCalls } = fakeClient({ selectResult: { data: jobRow, error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    await store.findActiveByIdempotencyKey("L1:tmplv1:hash1");
    expect(selectCalls[0].calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["idempotency_key", "L1:tmplv1:hash1"] },
        { method: "in", args: ["state", ["queued", "running", "rendering", "uploading", "qa"]] },
      ]),
    );
  });

  it("findOldestQueued filters state='queued', orders by created_at ascending, limit 1", async () => {
    const { from, selectCalls } = fakeClient({ selectResult: { data: jobRow, error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    const job = await store.findOldestQueued();
    expect(selectCalls[0].calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["state", "queued"] },
        { method: "order", args: ["created_at", { ascending: true }] },
        { method: "limit", args: [1] },
      ]),
    );
    expect(job?.id).toBe("job1");
  });
});

describe("SupabaseJobsStore.claimQueued — atomic compare-and-set", () => {
  it("issues an UPDATE filtered by BOTH id AND state='queued' (never a read-then-write)", async () => {
    const claimedRow = { ...jobRow, state: "running", claimed_at: "T", claimed_by: "w1", heartbeat_at: "T" };
    const { from, updateCalls } = fakeClient({ updateResult: { data: [claimedRow], error: null } });
    const store = new SupabaseJobsStore({ from } as never);

    const claimed = await store.claimQueued("job1", "w1", "T");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).toMatchObject({ state: "running", claimed_by: "w1" });
    // The CAS guard: both filters MUST be present on the same update chain.
    expect(updateCalls[0].calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", "job1"] },
        { method: "eq", args: ["state", "queued"] },
      ]),
    );
    expect(claimed?.state).toBe("running");
    expect(claimed?.claimedBy).toBe("w1");
  });

  it("returns null (never throws) when the CAS matches zero rows — already claimed", async () => {
    const { from, updateCalls } = fakeClient({ updateResult: { data: [], error: null } });
    const store = new SupabaseJobsStore({ from } as never);

    const claimed = await store.claimQueued("job1", "w2", "T2");

    expect(claimed).toBeNull();
    // The update was still attempted with the correct CAS filters — the adapter didn't
    // skip the call, it correctly interpreted an empty result set as a lost race.
    expect(updateCalls[0].calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", "job1"] },
        { method: "eq", args: ["state", "queued"] },
      ]),
    );
  });

  it("propagates a genuine DB error distinctly from a lost CAS", async () => {
    const { from } = fakeClient({ updateResult: { data: null, error: { message: "connection reset" } } });
    const store = new SupabaseJobsStore({ from } as never);
    await expect(store.claimQueued("job1", "w1", "T")).rejects.toThrow(/connection reset/);
  });
});

describe("SupabaseJobsStore.updateJob / appendTransition / listStaleActive / listJobsByOwner / listTransitionsByOwner", () => {
  it("updateJob maps a partial camelCase patch to snake_case columns and back", async () => {
    const updatedRow = { ...jobRow, state: "rendering" };
    const { from, updateCalls } = fakeClient({ updateResult: { data: updatedRow, error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    const job = await store.updateJob("job1", { state: "rendering", heartbeatAt: "T" });
    expect(updateCalls[0].patch).toEqual({ state: "rendering", heartbeat_at: "T" });
    expect(job.state).toBe("rendering");
  });

  it("appendTransition inserts into creative_job_transitions and maps from/to <-> from_state/to_state", async () => {
    const transitionRow = {
      id: "t1",
      job_id: "job1",
      listing_id: "L1",
      user_id: "O1",
      from_state: "queued",
      to_state: "running",
      duration_ms: 5,
      cost_usd: 0,
      cost_provider: null,
      provider: null,
      capability: null,
      attempt: 1,
      actor: "worker",
      metadata: {},
      error_code: null,
      error_message: null,
      trace_id: null,
      at: "2026-07-15T00:00:00.001Z",
    };
    const { from, insertCalls } = fakeClient({ insertResult: { data: transitionRow, error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    const stored = await store.appendTransition({
      jobId: "job1",
      listingId: "L1",
      userId: "O1",
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
      at: "2026-07-15T00:00:00.001Z",
    });
    expect(insertCalls[0].row).toMatchObject({ from_state: "queued", to_state: "running", job_id: "job1" });
    expect(stored).toMatchObject({ id: "t1", from: "queued", to: "running" });
  });

  it("listStaleActive filters state IN (running, rendering, uploading, qa) AND heartbeat_at < staleBeforeIso", async () => {
    const { from, selectCalls } = fakeClient({ selectResult: { data: [jobRow], error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    await store.listStaleActive("2026-07-15T01:00:00.000Z");
    expect(selectCalls[0].calls).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["state", ["running", "rendering", "uploading", "qa"]] },
        { method: "lt", args: ["heartbeat_at", "2026-07-15T01:00:00.000Z"] },
      ]),
    );
  });

  it("listJobsByOwner / listTransitionsByOwner filter by owner_id / user_id respectively", async () => {
    const jobsStore = new SupabaseJobsStore({
      from: fakeClient({ selectResult: { data: [jobRow], error: null } }).from,
    } as never);
    const jobs = await jobsStore.listJobsByOwner("O1");
    expect(jobs).toHaveLength(1);

    const { from, selectCalls } = fakeClient({ selectResult: { data: [], error: null } });
    const store2 = new SupabaseJobsStore({ from } as never);
    await store2.listTransitionsByOwner("O1");
    expect(selectCalls[0].calls).toEqual(expect.arrayContaining([{ method: "eq", args: ["user_id", "O1"] }]));
  });

  it("listTransitionsByJob filters by job_id and orders by at ascending (job-scoped, not owner-scoped)", async () => {
    const { from, selectCalls } = fakeClient({ selectResult: { data: [], error: null } });
    const store = new SupabaseJobsStore({ from } as never);
    await store.listTransitionsByJob("job1");
    expect(selectCalls[0].calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["job_id", "job1"] },
        { method: "order", args: ["at", { ascending: true }] },
      ]),
    );
  });
});

// End-to-end wiring: jobs.ts's pure `createJob`/`claimNextQueued` functions driven
// against a SupabaseJobsStore backed by the mock client — proves the adapter's
// UniqueViolationError and CAS-null contracts are exactly what jobs.ts's application
// logic expects, not just what this file's own unit tests assert in isolation.
describe("createJob / claimNextQueued wired through SupabaseJobsStore (integration)", () => {
  it("createJob: a 23505 on insert is caught and re-queried — resolves to the existing job, never throws", async () => {
    // jobs.ts#createJob first does a fast-path `findActiveByIdempotencyKey` check
    // (must see nothing yet, or this test wouldn't reach the insert at all), THEN
    // inserts (fails with 23505), THEN re-queries `findActiveByIdempotencyKey` again
    // (must now see the winner's row). So `select` returns empty on its first call and
    // `jobRow` from the second call onward.
    let insertCallCount = 0;
    let selectCallCount = 0;
    const from = vi.fn((_table: string) => ({
      insert: vi.fn((_row: unknown) => {
        insertCallCount += 1;
        return makeBuilder({ data: null, error: { code: "23505", message: "duplicate active idempotency key" } })
          .builder;
      }),
      update: vi.fn(() => makeBuilder({ data: [], error: null }).builder),
      select: vi.fn(() => {
        selectCallCount += 1;
        const result = selectCallCount === 1 ? { data: null, error: null } : { data: jobRow, error: null };
        return makeBuilder(result).builder;
      }),
    }));
    const store = new SupabaseJobsStore({ from } as never);

    const job = await createJob(store, {
      listingId: "L1",
      ownerId: "O1",
      capability: "video",
      idempotencyKey: "L1:tmplv1:hash1",
      nowMs: 0,
    });

    expect(job.id).toBe("job1"); // the WINNER's row, returned via re-query
    expect(insertCallCount).toBe(1); // createJob attempted exactly one insert
    expect(selectCallCount).toBe(2); // fast-path check (empty) + post-conflict re-query (hit)
  });

  it("claimNextQueued: a lost CAS (zero rows) returns null and never appends a transition", async () => {
    let selectCallCount = 0;
    const appendedTransitions: unknown[] = [];
    const from = vi.fn((_table: string) => ({
      insert: vi.fn((row: unknown) => {
        appendedTransitions.push(row);
        return makeBuilder({ data: { ...jobRow, id: "t-any" }, error: null }).builder;
      }),
      update: vi.fn(() => makeBuilder({ data: [], error: null }).builder), // CAS always loses
      select: vi.fn(() => {
        selectCallCount += 1;
        return makeBuilder({ data: jobRow, error: null }).builder; // findOldestQueued sees a candidate
      }),
    }));
    const store = new SupabaseJobsStore({ from } as never);

    const result = await claimNextQueued(store, "worker-1", { nowMs: 10 });

    expect(result).toBeNull();
    expect(selectCallCount).toBeGreaterThan(0); // findOldestQueued was consulted
    expect(appendedTransitions).toHaveLength(0); // the loser never appends a 'running' transition
  });

  it("claimNextQueued: a won CAS returns the claimed job and appends exactly one 'running' transition", async () => {
    const claimedRow = { ...jobRow, state: "running", claimed_at: "T", claimed_by: "worker-1", heartbeat_at: "T" };
    const appendedTransitions: Array<Record<string, unknown>> = [];
    const from = vi.fn((_table: string) => ({
      insert: vi.fn((row: Record<string, unknown>) => {
        appendedTransitions.push(row);
        return makeBuilder({ data: { id: "t1", ...row }, error: null }).builder;
      }),
      update: vi.fn(() => makeBuilder({ data: [claimedRow], error: null }).builder), // CAS wins
      select: vi.fn(() => makeBuilder({ data: jobRow, error: null }).builder), // findOldestQueued sees the candidate
    }));
    const store = new SupabaseJobsStore({ from } as never);

    const result = await claimNextQueued(store, "worker-1", { nowMs: 42 });

    expect(result?.id).toBe("job1");
    expect(result?.state).toBe("running");
    expect(appendedTransitions).toHaveLength(1);
    expect(appendedTransitions[0]).toMatchObject({ from_state: "queued", to_state: "running" });
  });
});

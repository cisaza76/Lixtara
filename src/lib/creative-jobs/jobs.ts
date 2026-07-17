// The durable Creative Job layer: persistence is injected via the `JobsStore` port
// (mirrors the AssetStore pattern in @/lib/assets), so this stays a pure application
// layer, unit-testable with an in-memory fake — no DB in tests. camelCase mirror of
// `public.creative_jobs` / `public.creative_job_transitions`
// (supabase/migrations/20260715171914_creative_studio_video.sql — authored, NOT
// applied). This module is job durability only: no LLM/cost-gating/provider-selection
// logic lives here.
//
// See docs/superpowers/specs/2026-07-15-creative-jobs-observability-design.md.
import {
  buildTransition,
  canTransition,
  type CreativeJobState,
  type JobTransition,
  type TransitionCost,
  type TransitionError,
} from "@/lib/creative-jobs/states";
import { isUniqueViolation, UniqueViolationError } from "@/lib/db/pg-errors";

// Re-exported for backward compatibility: callers/tests historically imported
// `UniqueViolationError` from this module. The canonical class now lives in
// src/lib/db/pg-errors.ts (shared with @/lib/assets/asset-store.supabase) so an
// `instanceof` check works across store boundaries.
export { UniqueViolationError };

export interface CreativeJob {
  id: string;
  listingId: string;
  ownerId: string;
  capability: string;
  state: CreativeJobState;
  assetId: string | null; // set at 'uploading'
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  claimedAt: string | null;
  claimedBy: string | null;
  heartbeatAt: string | null;
  cancellationRequested: boolean;
  timeoutMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  // Reserved: correlation id across job/transition/renderer/upload/QA. Not populated
  // everywhere yet — set at creation, inherited by the job's transitions in `setState`.
  traceId?: string | null;
}

export interface StoredTransition extends JobTransition {
  id: string;
  at: string; // ISO timestamp, stamped by appendTransition's caller (never Date.now() in states.ts)
}

// Active (non-terminal, "the job is doing something") states — used to decide when to
// refresh heartbeat_at.
export const ACTIVE_JOB_STATES: CreativeJobState[] = ["running", "rendering", "uploading", "qa"];

// The persistence port. Deliberately has NO update/delete for transitions — append-only
// is structural, not a convention callers have to remember (same discipline as
// AssetStore's missing update/replace-bytes method).
export interface JobsStore {
  insertJob(job: Omit<CreativeJob, "id">): Promise<CreativeJob>;
  getJob(jobId: string): Promise<CreativeJob | null>;
  /** Latest job for a listing, newest by created_at, or null if the listing has none. */
  findLatestByListing(listingId: string): Promise<CreativeJob | null>;
  // Any job with this idempotency key currently in a non-terminal state — mirrors the
  // partial unique index `creative_jobs_idempotency_active`.
  findActiveByIdempotencyKey(key: string): Promise<CreativeJob | null>;
  // Oldest queued job (claim candidate), or null if none. Live lookups only — callers
  // must not assume the returned snapshot is still current by the time they act on it.
  findOldestQueued(): Promise<CreativeJob | null>;
  // Atomic compare-and-set: succeeds only if the job's CURRENT state is still 'queued'
  // at the moment of the call (mirrors `UPDATE ... WHERE state='queued' RETURNING *`).
  // Returns null if another claimer already won the race.
  claimQueued(jobId: string, workerId: string, nowIso: string): Promise<CreativeJob | null>;
  updateJob(jobId: string, patch: Partial<Omit<CreativeJob, "id">>): Promise<CreativeJob>;
  appendTransition(transition: JobTransition & { at: string }): Promise<StoredTransition>;
  // Jobs in ANY active state (ACTIVE_JOB_STATES — running/rendering/uploading/qa) whose
  // heartbeat_at is older than staleBeforeIso. A worker can die mid-upload or mid-QA
  // just as easily as mid-render, so recovery must cover the whole active set, not just
  // running/rendering — see recoverAbandoned's doc comment for why this is safe.
  listStaleActive(staleBeforeIso: string): Promise<CreativeJob[]>;
  listJobsByOwner(ownerId: string): Promise<CreativeJob[]>;
  listTransitionsByOwner(ownerId: string): Promise<StoredTransition[]>;
  // Every transition for ONE job, oldest -> newest (mirrors `WHERE job_id = ? ORDER BY
  // at`). A job-id-scoped read — unlike `listTransitionsByOwner`, this doesn't require
  // pulling an owner's entire transition history into memory just to filter it down to
  // one job (see getJobTimeline, src/lib/creative-jobs/timeline.ts, the only caller).
  listTransitionsByJob(jobId: string): Promise<StoredTransition[]>;
}

// Single insert path for a transition. Never updates/deletes — the JobsStore port has
// no such method, so there is structurally no code path that could mutate history.
export async function appendTransition(
  store: JobsStore,
  transition: JobTransition,
  atIso: string,
): Promise<StoredTransition> {
  return store.appendTransition({ ...transition, at: atIso });
}

export interface CreateJobInput {
  listingId: string;
  ownerId: string;
  capability: string;
  idempotencyKey: string;
  maxAttempts?: number;
  timeoutMs?: number;
  nowMs?: number; // defaults to Date.now(); tests pass explicitly for determinism
  // Reserved: correlation id across job/transition/renderer/upload/QA (default null).
  traceId?: string | null;
}

// Inserts a new job in state 'queued'. If an ACTIVE job (non-terminal state) with the
// same idempotencyKey already exists, returns THAT job instead of inserting a duplicate
// — mirrors the partial unique index `creative_jobs_idempotency_active`.
export async function createJob(store: JobsStore, input: CreateJobInput): Promise<CreativeJob> {
  // Read-first fast path: an optimization only, NOT the correctness guarantee — two
  // concurrent callers with the same idempotencyKey can both pass this check before
  // either has inserted (classic check-then-act race). The catch below is what makes
  // this conflict-safe: it relies on the partial unique index
  // `creative_jobs_idempotency_active` (mirrored by the fake store's insertJob) to
  // reject the losing insert, and recovers by returning the winner's row instead of
  // propagating the error.
  const existing = await store.findActiveByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;

  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  try {
    return await store.insertJob({
      listingId: input.listingId,
      ownerId: input.ownerId,
      capability: input.capability,
      state: "queued",
      assetId: null,
      idempotencyKey: input.idempotencyKey,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      claimedAt: null,
      claimedBy: null,
      heartbeatAt: null,
      cancellationRequested: false,
      timeoutMs: input.timeoutMs ?? 600_000,
      errorCode: null,
      errorMessage: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      traceId: input.traceId ?? null,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Lost the race: another concurrent call won the insert. Re-query (not the stale
    // `existing` from above) and return the winner's row instead of failing the caller.
    const winner = await store.findActiveByIdempotencyKey(input.idempotencyKey);
    if (winner) return winner;
    throw err; // no active row found (shouldn't happen) — surface the original error
  }
}

export interface SetStateMeta {
  actor: "seller" | "worker" | "system";
  cost?: TransitionCost;
  provider?: string;
  capability?: string;
  attempt?: number;
  error?: TransitionError;
  metadata?: Record<string, unknown>;
  assetId?: string | null; // set at 'uploading'
  nowMs?: number; // defaults to Date.now(); tests pass explicitly for determinism
}

// Guarded state change: throws on an illegal `from -> to` (canTransition), bumps
// updated_at, refreshes heartbeat_at on active states, sets a structured error_code on
// `-> failed`, and appends the transition — all as one logical step.
export async function setState(
  store: JobsStore,
  jobId: string,
  to: CreativeJobState,
  meta: SetStateMeta,
): Promise<CreativeJob> {
  const job = await store.getJob(jobId);
  if (!job) throw new Error(`creative job not found: ${jobId}`);
  if (!canTransition(job.state, to)) {
    throw new Error(`illegal creative job transition: ${job.state} -> ${to}`);
  }

  const nowMs = meta.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const isFailure = to === "failed";
  const isActive = ACTIVE_JOB_STATES.includes(to);

  const transition = buildTransition({
    jobId: job.id,
    listingId: job.listingId,
    userId: job.ownerId,
    from: job.state,
    to,
    actor: meta.actor,
    enteredAtMs: new Date(job.updatedAt).getTime(),
    nowMs,
    cost: meta.cost,
    provider: meta.provider,
    capability: meta.capability,
    attempt: meta.attempt ?? 1,
    error: meta.error,
    metadata: meta.metadata,
    // A transition inherits its job's trace id (job.traceId), not the caller's meta —
    // that's the durable correlation id set at job creation.
    traceId: job.traceId ?? null,
  });

  const updated = await store.updateJob(job.id, {
    state: to,
    updatedAt: nowIso,
    heartbeatAt: isActive ? nowIso : job.heartbeatAt,
    assetId: meta.assetId !== undefined ? meta.assetId : job.assetId,
    errorCode: isFailure ? (meta.error?.code ?? "unknown") : job.errorCode,
    errorMessage: isFailure ? (meta.error?.message ?? null) : job.errorMessage,
  });

  await appendTransition(store, transition, nowIso);
  return updated;
}

export interface ClaimOptions {
  nowMs?: number; // defaults to Date.now(); tests pass explicitly for determinism
}

// Atomic claim of the oldest queued job. Two concurrent callers racing for the same
// job: exactly one gets it back, the other gets null (claimQueued's compare-and-set
// guards this — see JobsStore doc). The CAS claim happens FIRST, before the
// cancellation check, so at most one caller can ever observe itself as the winner for
// a given job — a job with cancellation_requested is therefore never handed to a
// worker, but the resulting transition is logged exactly once, by the uncontested
// winner (running -> cancelled is a legal edge; see the design doc's race note). The
// loser's claimQueued call fails the CAS and returns null before it ever builds a
// transition, so it cannot race the winner into a duplicate append.
export async function claimNextQueued(
  store: JobsStore,
  workerId: string,
  opts: ClaimOptions = {},
): Promise<CreativeJob | null> {
  const candidate = await store.findOldestQueued();
  if (!candidate) return null;

  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const claimed = await store.claimQueued(candidate.id, workerId, nowIso);
  if (!claimed) return null; // lost the compare-and-set race to another claimer

  if (claimed.cancellationRequested) {
    // We hold the only claim on this job (CAS already won), so it's now uncontested:
    // transition it straight to 'cancelled' instead of handing it to the worker.
    await setState(store, claimed.id, "cancelled", {
      actor: "system",
      nowMs,
      metadata: { reason: "cancellation_requested" },
    });
    return null;
  }

  const transition = buildTransition({
    jobId: claimed.id,
    listingId: claimed.listingId,
    userId: claimed.ownerId,
    from: "queued",
    to: "running",
    actor: "worker",
    enteredAtMs: new Date(candidate.updatedAt).getTime(),
    nowMs,
    attempt: candidate.attempts + 1,
    metadata: { claimedBy: workerId },
  });
  await appendTransition(store, transition, nowIso);
  return claimed;
}

// Sweeps ALL active-state jobs (ACTIVE_JOB_STATES — running/rendering/uploading/qa,
// via `store.listStaleActive`) whose heartbeat_at is older than staleMs: re-queues them
// (incrementing attempts) if budget remains, else fails them with a structured timeout
// error_code. A worker can die mid-upload or mid-QA exactly as easily as mid-render —
// restricting recovery to running/rendering alone would strand those jobs forever, with
// no supervisory path back to queued. This is a supervisory reset, not a normal forward
// transition — none of `running/rendering/qa/uploading -> queued` is in
// LEGAL_TRANSITIONS (a worker never "chooses" to go back to queued), so recovery
// bypasses setState's canTransition guard by design and logs directly, always
// actor:"system", for every one of these four source states. This is safe even for a
// job that had already uploaded before crashing: `processJob`'s retry-reconciliation
// step (`deps.reconcile`, matched on the job's idempotency key / traceId) runs BEFORE
// any render/upload work on the retried attempt and fast-forwards straight to
// `completed` instead of re-rendering or re-uploading, so requeuing a stale `qa`/
// `uploading` job cannot produce a duplicate Asset or Storage object.
export async function recoverAbandoned(
  store: JobsStore,
  nowMs: number,
  staleMs: number,
): Promise<CreativeJob[]> {
  const staleBeforeIso = new Date(nowMs - staleMs).toISOString();
  const stale = await store.listStaleActive(staleBeforeIso);
  const nowIso = new Date(nowMs).toISOString();
  const recovered: CreativeJob[] = [];

  for (const job of stale) {
    // Capture everything the transition record needs BEFORE calling store.updateJob:
    // a store implementation may mutate the row object in place (an in-memory fake
    // does; a real DB round-trip would not), so reading `job.state`/`job.attempts`
    // after the write is not safe to rely on.
    const fromState = job.state;
    const attemptsBefore = job.attempts;
    const enteredAtMs = new Date(job.updatedAt).getTime();

    if (attemptsBefore < job.maxAttempts) {
      const nextAttempt = attemptsBefore + 1;
      const updated = await store.updateJob(job.id, {
        state: "queued",
        attempts: nextAttempt,
        claimedAt: null,
        claimedBy: null,
        heartbeatAt: null,
        updatedAt: nowIso,
      });
      const transition = buildTransition({
        jobId: job.id,
        listingId: job.listingId,
        userId: job.ownerId,
        from: fromState,
        to: "queued",
        actor: "system",
        enteredAtMs,
        nowMs,
        attempt: nextAttempt,
        metadata: { reason: "heartbeat_stale", requeued: true },
      });
      await appendTransition(store, transition, nowIso);
      recovered.push(updated);
    } else {
      const error = {
        code: "timeout",
        message: "abandoned: heartbeat stale past max_attempts",
      };
      const updated = await store.updateJob(job.id, {
        state: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: nowIso,
      });
      const transition = buildTransition({
        jobId: job.id,
        listingId: job.listingId,
        userId: job.ownerId,
        from: fromState,
        to: "failed",
        actor: "system",
        enteredAtMs,
        nowMs,
        attempt: attemptsBefore,
        error,
        metadata: { reason: "heartbeat_stale" },
      });
      await appendTransition(store, transition, nowIso);
      recovered.push(updated);
    }
  }

  return recovered;
}

// Marks the job for cancellation. Does not itself transition the job — a subsequent
// claim (claimNextQueued, for a still-queued job) or an active worker's own step
// honors the flag.
export async function requestCancel(store: JobsStore, jobId: string): Promise<CreativeJob> {
  const job = await store.getJob(jobId);
  if (!job) throw new Error(`creative job not found: ${jobId}`);
  return store.updateJob(jobId, { cancellationRequested: true });
}

// Owner-scoped reads (RLS-equivalent isolation at the application layer, matching the
// `owner_id = auth.uid()` / `user_id = auth.uid()` policies on the real tables).
export async function listJobsForOwner(store: JobsStore, ownerId: string): Promise<CreativeJob[]> {
  return store.listJobsByOwner(ownerId);
}

export async function listTransitionsForOwner(
  store: JobsStore,
  ownerId: string,
): Promise<StoredTransition[]> {
  return store.listTransitionsByOwner(ownerId);
}

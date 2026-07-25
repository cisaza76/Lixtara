// Supabase-backed JobsStore (public.creative_jobs / public.creative_job_transitions) —
// maps the camelCase `CreativeJob`/`StoredTransition` shapes (jobs.ts) onto the
// snake_case tables (supabase/migrations/20260715171914_creative_studio_video.sql —
// authored, NOT applied). The constructor takes the REAL Supabase client type; every
// `.from(...)` call site narrows the result to a small local `JobsTable` shape via
// `as unknown as` so TS never structurally compares the whole recursive Postgrest
// builder type against a hand-rolled interface (that comparison is what blows up with
// TS2589 — see src/lib/creative-jobs/wiring.ts for the compile-time regression guard).
// A test fake needs no SDK import at all.
//
// CRITICAL: `claimQueued` is a genuine atomic compare-and-set. The UPDATE itself is
// filtered by BOTH `id` AND `state = 'queued'` — never a read-then-write. Zero rows
// back means another claimer already won the race (or the job left 'queued' for some
// other reason); that is reported as `null`, not an error.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";
import { ACTIVE_JOB_STATES, UniqueViolationError } from "@/lib/creative-jobs/jobs";
import type { CreativeJobState, JobTransition } from "@/lib/creative-jobs/states";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-errors";

const JOBS_TABLE = "creative_jobs";
const TRANSITIONS_TABLE = "creative_job_transitions";

// Mirrors the partial unique index `creative_jobs_idempotency_active` — INCLUDES
// 'queued', unlike jobs.ts's `ACTIVE_JOB_STATES` (which is a different concept: states
// whose heartbeat_at gets refreshed on a transition).
const IDEMPOTENCY_ACTIVE_STATES = ["queued", "running", "rendering", "uploading", "qa"];

// Claim-recovery candidates for `listStaleActive` — every ACTIVE_JOB_STATES member
// (running/rendering/uploading/qa), not just running/rendering: a worker can die
// mid-upload or mid-QA exactly as easily as mid-render, and jobs.ts#recoverAbandoned's
// retry-reconciliation path (via processJob's `deps.reconcile`) makes requeuing any of
// these states safe — see recoverAbandoned's doc comment. Reuses `ACTIVE_JOB_STATES`
// (jobs.ts) directly rather than a hand-duplicated list so the two can never drift.
const STALE_CANDIDATE_STATES: CreativeJobState[] = ACTIVE_JOB_STATES;

type PgError = { code?: string; message?: string } | null;

interface JobRow {
  id: string;
  listing_id: string;
  owner_id: string;
  capability: string;
  state: string;
  asset_id: string | null;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  claimed_at: string | null;
  claimed_by: string | null;
  heartbeat_at: string | null;
  cancellation_requested: boolean;
  timeout_ms: number;
  error_code: string | null;
  error_message: string | null;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TransitionRow {
  id: string;
  job_id: string;
  listing_id: string;
  user_id: string;
  from_state: string;
  to_state: string;
  duration_ms: number;
  cost_usd: number;
  cost_provider: string | null;
  provider: string | null;
  capability: string | null;
  attempt: number;
  actor: string;
  metadata: unknown;
  error_code: string | null;
  error_message: string | null;
  trace_id: string | null;
  at: string;
}

// The subset of a Postgrest query-builder this file relies on: chainable filters that
// are ALSO directly awaitable (mirrors the real @supabase/supabase-js builder, which is
// simultaneously thenable and chainable) plus the terminal `.maybeSingle()`. Reused for
// BOTH tables — the call SHAPE is identical; row typing is handled by this file's own
// mapping functions, not by the client interface.
interface JobsQueryBuilder extends PromiseLike<{ data: unknown; error: PgError }> {
  eq(col: string, val: unknown): JobsQueryBuilder;
  in(col: string, vals: unknown[]): JobsQueryBuilder;
  lt(col: string, val: unknown): JobsQueryBuilder;
  order(col: string, opts: { ascending: boolean }): JobsQueryBuilder;
  limit(n: number): JobsQueryBuilder;
  select(cols?: string): JobsQueryBuilder;
  maybeSingle(): PromiseLike<{ data: unknown; error: PgError }>;
}

interface JobsTable {
  insert(row: unknown): JobsQueryBuilder;
  update(patch: unknown): JobsQueryBuilder;
  select(cols?: string): JobsQueryBuilder;
}

// Narrows a real `.from(table)` call to `JobsTable`, going through `unknown` first so TS
// never has to structurally compare the real recursive PostgrestQueryBuilder type
// against this file's narrow interface (that comparison is what triggers TS2589).
// Reused for BOTH tables — the call SHAPE is identical; row typing is handled by this
// file's own mapping functions, not by this helper.
function jobsTable(client: SupabaseClient, table: string): JobsTable {
  return client.from(table) as unknown as JobsTable;
}

function pgMessage(error: PgError): string {
  return error?.message ?? "unknown error";
}

function jobFromRow(row: JobRow): CreativeJob {
  return {
    id: row.id,
    listingId: row.listing_id,
    ownerId: row.owner_id,
    capability: row.capability,
    state: row.state as CreativeJobState,
    assetId: row.asset_id,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    heartbeatAt: row.heartbeat_at,
    cancellationRequested: row.cancellation_requested,
    timeoutMs: row.timeout_ms,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    traceId: row.trace_id,
  };
}

function jobInsertRow(job: Omit<CreativeJob, "id">): Record<string, unknown> {
  return {
    listing_id: job.listingId,
    owner_id: job.ownerId,
    capability: job.capability,
    state: job.state,
    asset_id: job.assetId,
    idempotency_key: job.idempotencyKey,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    claimed_at: job.claimedAt,
    claimed_by: job.claimedBy,
    heartbeat_at: job.heartbeatAt,
    cancellation_requested: job.cancellationRequested,
    timeout_ms: job.timeoutMs,
    error_code: job.errorCode,
    error_message: job.errorMessage,
    trace_id: job.traceId ?? null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

// camelCase CreativeJob patch key -> snake_case `creative_jobs` column. Only keys
// present on the incoming partial patch are ever written (see `jobPatchRow`) — a
// SupabaseJobsStore.updateJob caller (setState, recoverAbandoned, requestCancel) never
// unintentionally clobbers a column it didn't mean to touch.
const JOB_PATCH_KEY_MAP: Record<keyof Omit<CreativeJob, "id">, string> = {
  listingId: "listing_id",
  ownerId: "owner_id",
  capability: "capability",
  state: "state",
  assetId: "asset_id",
  idempotencyKey: "idempotency_key",
  attempts: "attempts",
  maxAttempts: "max_attempts",
  claimedAt: "claimed_at",
  claimedBy: "claimed_by",
  heartbeatAt: "heartbeat_at",
  cancellationRequested: "cancellation_requested",
  timeoutMs: "timeout_ms",
  errorCode: "error_code",
  errorMessage: "error_message",
  createdAt: "created_at",
  updatedAt: "updated_at",
  traceId: "trace_id",
};

function jobPatchRow(patch: Partial<Omit<CreativeJob, "id">>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof Omit<CreativeJob, "id">>) {
    const col = JOB_PATCH_KEY_MAP[key];
    if (col) row[col] = patch[key];
  }
  return row;
}

function transitionFromRow(row: TransitionRow): StoredTransition {
  return {
    id: row.id,
    jobId: row.job_id,
    listingId: row.listing_id,
    userId: row.user_id,
    from: row.from_state as CreativeJobState,
    to: row.to_state as CreativeJobState,
    actor: row.actor as JobTransition["actor"],
    durationMs: row.duration_ms,
    costUsd: row.cost_usd,
    costProvider: row.cost_provider,
    provider: row.provider,
    capability: row.capability,
    attempt: row.attempt,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    traceId: row.trace_id,
    at: row.at,
  };
}

function transitionInsertRow(t: JobTransition & { at: string }): Record<string, unknown> {
  return {
    job_id: t.jobId,
    listing_id: t.listingId,
    user_id: t.userId,
    from_state: t.from,
    to_state: t.to,
    duration_ms: t.durationMs,
    cost_usd: t.costUsd,
    cost_provider: t.costProvider,
    provider: t.provider,
    capability: t.capability,
    attempt: t.attempt,
    actor: t.actor,
    metadata: t.metadata,
    error_code: t.errorCode,
    error_message: t.errorMessage,
    trace_id: t.traceId ?? null,
    at: t.at,
  };
}

// Real integration: Supabase Postgres via the service-role client (server/worker
// context only — see src/lib/supabase/service.ts, and the RLS comment in the P2
// migration: sellers are read-only on all three tables, so a seller session could never
// exercise this class's write paths even if it were mistakenly handed one).
export class SupabaseJobsStore implements JobsStore {
  constructor(private readonly client: SupabaseClient) {}

  async insertJob(job: Omit<CreativeJob, "id">): Promise<CreativeJob> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .insert(jobInsertRow(job))
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        // Mirrors `creative_jobs_idempotency_active` — jobs.ts#createJob catches this
        // uniformly (via `isUniqueViolation`) and re-queries instead of failing the
        // caller.
        throw new UniqueViolationError(error.message);
      }
      throw new Error(`creative_jobs insert failed: ${pgMessage(error)}`);
    }
    if (!data) throw new Error("creative_jobs insert failed: no row returned");
    return jobFromRow(data as JobRow);
  }

  async getJob(jobId: string): Promise<CreativeJob | null> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE).select("*").eq("id", jobId).maybeSingle();
    if (error) throw new Error(`creative_jobs getJob failed: ${pgMessage(error)}`);
    return data ? jobFromRow(data as JobRow) : null;
  }

  async findLatestByListing(listingId: string): Promise<CreativeJob | null> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`creative_jobs findLatestByListing failed: ${pgMessage(error)}`);
    return data ? jobFromRow(data as JobRow) : null;
  }

  async findActiveByIdempotencyKey(key: string): Promise<CreativeJob | null> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .select("*")
      .eq("idempotency_key", key)
      .in("state", IDEMPOTENCY_ACTIVE_STATES)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`creative_jobs findActiveByIdempotencyKey failed: ${pgMessage(error)}`);
    return data ? jobFromRow(data as JobRow) : null;
  }

  async findOldestQueued(): Promise<CreativeJob | null> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .select("*")
      .eq("state", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`creative_jobs findOldestQueued failed: ${pgMessage(error)}`);
    return data ? jobFromRow(data as JobRow) : null;
  }

  // Atomic compare-and-set: `UPDATE creative_jobs SET state='running', claimed_at=?,
  // claimed_by=?, heartbeat_at=?, updated_at=? WHERE id=? AND state='queued' RETURNING
  // *`. The WHERE clause — not a prior read — is what makes this safe under
  // concurrency: two callers racing the same jobId both issue this UPDATE, Postgres
  // serializes them, and only the one that still sees state='queued' at execution time
  // matches any row. The loser's UPDATE matches zero rows; `.select()` on zero matched
  // rows returns an empty array (not an error), which this method reports as `null` —
  // "already claimed" — never a read-then-write race.
  async claimQueued(jobId: string, workerId: string, nowIso: string): Promise<CreativeJob | null> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .update({
        state: "running",
        claimed_at: nowIso,
        claimed_by: workerId,
        heartbeat_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", jobId)
      .eq("state", "queued")
      .select();
    if (error) throw new Error(`creative_jobs claimQueued failed: ${pgMessage(error)}`);
    const rows = (data as JobRow[] | null) ?? [];
    if (rows.length === 0) return null; // lost the compare-and-set race
    return jobFromRow(rows[0]);
  }

  async updateJob(jobId: string, patch: Partial<Omit<CreativeJob, "id">>): Promise<CreativeJob> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .update(jobPatchRow(patch))
      .eq("id", jobId)
      .select()
      .maybeSingle();
    if (error) throw new Error(`creative_jobs updateJob failed: ${pgMessage(error)}`);
    if (!data) throw new Error(`creative_jobs updateJob failed: no such job: ${jobId}`);
    return jobFromRow(data as JobRow);
  }

  // Single insert path for a transition — no update/delete method exists on this class
  // (or the JobsStore port) at all, so append-only is structural here too.
  async appendTransition(transition: JobTransition & { at: string }): Promise<StoredTransition> {
    const { data, error } = await jobsTable(this.client, TRANSITIONS_TABLE)
      .insert(transitionInsertRow(transition))
      .select()
      .maybeSingle();
    if (error) throw new Error(`creative_job_transitions insert failed: ${pgMessage(error)}`);
    if (!data) throw new Error("creative_job_transitions insert failed: no row returned");
    return transitionFromRow(data as TransitionRow);
  }

  async listStaleActive(staleBeforeIso: string): Promise<CreativeJob[]> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE)
      .select("*")
      .in("state", STALE_CANDIDATE_STATES)
      .lt("heartbeat_at", staleBeforeIso);
    if (error) throw new Error(`creative_jobs listStaleActive failed: ${pgMessage(error)}`);
    return ((data as JobRow[] | null) ?? []).map(jobFromRow);
  }

  async listJobsByOwner(ownerId: string): Promise<CreativeJob[]> {
    const { data, error } = await jobsTable(this.client, JOBS_TABLE).select("*").eq("owner_id", ownerId);
    if (error) throw new Error(`creative_jobs listJobsByOwner failed: ${pgMessage(error)}`);
    return ((data as JobRow[] | null) ?? []).map(jobFromRow);
  }

  async listTransitionsByOwner(ownerId: string): Promise<StoredTransition[]> {
    const { data, error } = await jobsTable(this.client, TRANSITIONS_TABLE).select("*").eq("user_id", ownerId);
    if (error) throw new Error(`creative_job_transitions listTransitionsByOwner failed: ${pgMessage(error)}`);
    return ((data as TransitionRow[] | null) ?? []).map(transitionFromRow);
  }

  async listTransitionsByJob(jobId: string): Promise<StoredTransition[]> {
    const { data, error } = await jobsTable(this.client, TRANSITIONS_TABLE)
      .select("*")
      .eq("job_id", jobId)
      .order("at", { ascending: true });
    if (error) throw new Error(`creative_job_transitions listTransitionsByJob failed: ${pgMessage(error)}`);
    return ((data as TransitionRow[] | null) ?? []).map(transitionFromRow);
  }
}

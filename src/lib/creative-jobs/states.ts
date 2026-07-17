// The Creative Job state machine: technical render lifecycle only (queued through
// completed/failed/cancelled). Pure — no I/O, no Date.now(), no persistence. Callers
// (jobs.ts) inject real timestamps and drive the store. Does not know about the Asset
// Lifecycle or Distribution machines (design spec §2) — this is the render machine.
// See docs/superpowers/specs/2026-07-15-creative-jobs-observability-design.md.

export const CREATIVE_JOB_STATES = [
  "queued", "running", "rendering", "uploading", "qa", "completed", "failed", "cancelled",
] as const;
export type CreativeJobState = (typeof CREATIVE_JOB_STATES)[number];

// Mirrors the `state` check constraint in `public.creative_jobs`
// (supabase/migrations/20260715171914_creative_studio_video.sql). Terminal states have
// no outgoing edges — enforced structurally by the empty array, not by a special case.
export const LEGAL_TRANSITIONS: Record<CreativeJobState, CreativeJobState[]> = {
  queued: ["running", "cancelled"],
  running: ["rendering", "failed", "cancelled"],
  rendering: ["qa", "failed", "cancelled"],
  qa: ["uploading", "failed"],
  uploading: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: CreativeJobState, to: CreativeJobState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export interface TransitionCost {
  amountUsd: number;
  provider: string;
}

export interface TransitionError {
  code: string;
  message: string;
}

// camelCase mirror of `public.creative_job_transitions`. Built by `buildTransition`,
// persisted append-only by `jobs.ts`'s `appendTransition` — never updated or deleted.
export interface JobTransition {
  jobId: string;
  listingId: string;
  userId: string;
  from: CreativeJobState;
  to: CreativeJobState;
  // Mirrors `creative_job_transitions.actor` (NOT NULL, CHECK in seller/worker/system).
  actor: "seller" | "worker" | "system";
  durationMs: number;
  costUsd: number;
  costProvider: string | null;
  provider: string | null;
  capability: string | null;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  // Reserved: correlation id across job/transition/renderer/upload/QA. Not populated
  // everywhere yet — inherited from the parent job by `jobs.ts#setState`.
  traceId?: string | null;
}

export interface BuildTransitionInput {
  jobId: string;
  listingId: string;
  userId: string;
  from: CreativeJobState;
  to: CreativeJobState;
  actor: "seller" | "worker" | "system";
  // Caller-supplied clock: when the job entered `from`, and "now" (the moment of this
  // transition). durationMs = nowMs - enteredAtMs. Pure code never calls Date.now().
  enteredAtMs: number;
  nowMs: number;
  cost?: TransitionCost;
  provider?: string;
  capability?: string;
  attempt: number;
  error?: TransitionError;
  metadata?: Record<string, unknown>;
  // Reserved: correlation id across job/transition/renderer/upload/QA (default null).
  traceId?: string | null;
}

// Pure: stamps duration from caller-provided timestamps, carries cost/provider/attempt
// through, and records error fields only on a transition into `failed` (mirrors the
// design spec's `error?: present only on → failed`). Does not validate legality —
// `jobs.ts#setState` guards with `canTransition` before calling this.
export function buildTransition(input: BuildTransitionInput): JobTransition {
  const isFailure = input.to === "failed";
  return {
    jobId: input.jobId,
    listingId: input.listingId,
    userId: input.userId,
    from: input.from,
    to: input.to,
    actor: input.actor,
    durationMs: input.nowMs - input.enteredAtMs,
    costUsd: input.cost?.amountUsd ?? 0,
    costProvider: input.cost?.provider ?? null,
    provider: input.provider ?? null,
    capability: input.capability ?? null,
    attempt: input.attempt,
    errorCode: isFailure ? (input.error?.code ?? null) : null,
    errorMessage: isFailure ? (input.error?.message ?? null) : null,
    metadata: input.metadata ?? {},
    traceId: input.traceId ?? null,
  };
}

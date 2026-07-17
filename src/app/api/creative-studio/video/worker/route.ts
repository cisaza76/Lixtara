// POST/GET /api/creative-studio/video/worker — Gate C1's decoupled durable worker
// (docs/superpowers/plans/2026-07-15-creative-studio-p2-video.md, Task 6, "Worker —
// secure cron, batch, budget"). Registered as a Vercel Cron in vercel.json. Vercel Cron
// triggers a GET with `Authorization: Bearer $CRON_SECRET`; POST is also exposed for a
// manual/local trigger under the same secret — both paths run the identical handler.
//
// This route NEVER accepts a job id from the request — it only claims from the queue
// atomically (`claimNextQueued`) and sweeps abandoned jobs. No stack trace or secret
// ever appears in the response; the body is always the small `{ claimed, processed,
// recovered }` summary.
//
// Gate D1 (docs/superpowers/plans/2026-07-15-creative-studio-p2-video.md, Task 7):
// `defaultRunDeps()` now wires the REAL `produce`/`reconcile` functions
// (src/lib/video-engine/worker-deps.ts) — real Supabase-backed Asset/Storage/Jobs
// adapters, the real `SandboxRemotionProvider`, and ffprobe-based QA — in place of
// Gate C1's stubs. Still CODE ONLY in the sense that matters: `CREATIVE_STUDIO_VIDEO_
// ENABLED` and `CRON_SECRET` are both unset in every environment as of this commit, so
// the enqueue route 404s (no job is ever queued) and this route always 401s before
// `runWorker`/`defaultRunDeps()` is ever reached — no real job has been claimed or
// processed by this wiring yet. Two further owner actions gate a real render even once
// the flags are set: a Sandbox base artifact (`CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` /
// `_IMAGE`) and an `ffprobe` binary on this route's own runtime — see worker-deps.ts's
// header comment and the production-readiness checklist.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createService } from "@/lib/supabase/service";
import {
  claimNextQueued,
  recoverAbandoned,
  type CreativeJob,
  type JobsStore,
} from "@/lib/creative-jobs/jobs";
import { SupabaseJobsStore } from "@/lib/creative-jobs/jobs-store.supabase";
import { capturePipelineError } from "@/lib/observability/sentry.server";
import { creativeVideoConfig } from "@/lib/video-engine/config";
import { processJob, type PipelineDeps } from "@/lib/video-engine/pipeline";
import { buildRealWorkerDeps } from "@/lib/video-engine/worker-deps";

// Constant-time compare of the SECRET VALUE only. The length pre-check is the
// standard, widely-used deviation for this pattern (Node's own `timingSafeEqual`
// throws on mismatched buffer lengths, so SOME length check is unavoidable before
// calling it) — it leaks only whether the lengths differ, never which characters
// matched, and CRON_SECRET's length is not itself sensitive. Never reveals WHY a
// request was rejected (missing header vs wrong value vs unconfigured env) — every
// failure path returns the same generic 401.
function verifyCronSecret(req: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false; // fail closed when unconfigured — never "open" by omission

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;

  const presentedBuf = Buffer.from(presented);
  const configuredBuf = Buffer.from(configured);
  if (presentedBuf.length !== configuredBuf.length) return false;
  return timingSafeEqual(presentedBuf, configuredBuf);
}

export interface RunDeps {
  jobs: JobsStore;
  now(): number;
  workerId: string;
  runJob(job: CreativeJob): Promise<CreativeJob>;
  recoverAbandoned(nowMs: number, staleMs: number): Promise<CreativeJob[]>;
  maxJobsPerRun: number;
  maxConcurrency: number;
  timeBudgetMs: number;
  staleAfterMs: number;
}

export interface RunSummary {
  claimed: number;
  processed: number;
  recovered: number;
}

// A null claim attempt (see below) doesn't necessarily mean the queue is empty — cap
// how many we tolerate IN A ROW before treating the queue as drained, so a genuinely
// empty queue (or a claimer stuck losing every CAS race) still terminates quickly
// instead of spinning. This is on top of the outer time budget, which always wins.
const MAX_CONSECUTIVE_NULL_CLAIMS = 3;

// Claims up to `maxJobsPerRun` jobs, one at a time, atomically (`claimNextQueued`
// itself is the compare-and-set — two concurrent workers racing for the same job never
// both win it). Respects `maxConcurrency` by waiting for an in-flight slot before
// claiming the next job, and stops CLAIMING (not necessarily processing already-claimed
// work) the moment the time budget is exhausted — any job left unclaimed simply stays
// `queued` for the next run; this is not an infinite queue drain. Never accepts a job id
// from the caller — `claimNextQueued` always picks the oldest eligible `queued` row
// itself.
//
// `claimNextQueued` returns `null` for THREE distinct reasons: the queue is genuinely
// empty, a concurrent claimer won the compare-and-set race first, or the oldest
// candidate had `cancellation_requested` and was transitioned straight to `cancelled`
// instead of being handed back (see jobs.ts). Only the first of those means "stop" — the
// other two mean "the head of the queue changed, try again" (a queued job behind a
// cancelled/raced head must not be starved). So a `null` claim `continue`s to retry
// rather than `break`ing the loop outright, bounded by
// `MAX_CONSECUTIVE_NULL_CLAIMS` consecutive nulls (approximates "queue drained") and by
// the outer time budget either way.
export async function runWorker(deps: RunDeps): Promise<RunSummary> {
  const startMs = deps.now();
  const budgetExhausted = () => deps.now() - startMs >= deps.timeBudgetMs;

  const recovered = await deps.recoverAbandoned(deps.now(), deps.staleAfterMs);

  let claimedCount = 0;
  let processed = 0;
  let consecutiveNullClaims = 0;
  const inFlight: Promise<void>[] = [];

  while (claimedCount < deps.maxJobsPerRun) {
    if (budgetExhausted()) break; // stop CLAIMING — remaining eligible jobs stay 'queued'

    if (inFlight.length >= deps.maxConcurrency) {
      await Promise.race(inFlight);
    }

    const job = await claimNextQueued(deps.jobs, deps.workerId, { nowMs: deps.now() });
    if (!job) {
      // Empty queue, lost CAS race, or a cancelled-on-claim head — NOT necessarily
      // "nothing left". Retry (the head may have changed), but only up to the bound.
      consecutiveNullClaims++;
      if (consecutiveNullClaims >= MAX_CONSECUTIVE_NULL_CLAIMS) break;
      continue;
    }
    consecutiveNullClaims = 0;
    claimedCount++;

    const p: Promise<void> = deps
      .runJob(job)
      .then(() => {
        processed++;
      })
      .catch(() => {
        // processJob already turns a job-level failure into a persisted 'failed'
        // CreativeJob row — a rejection reaching here means the pipeline itself threw
        // (a bug), which must never crash the whole cron run or leak a stack trace into
        // this route's response.
      })
      .finally(() => {
        const idx = inFlight.indexOf(p);
        if (idx !== -1) inFlight.splice(idx, 1);
      });
    inFlight.push(p);
  }

  await Promise.allSettled(inFlight); // don't respond until every claimed job has settled

  return { claimed: claimedCount, processed, recovered: recovered.length };
}

function defaultRunDeps(): RunDeps {
  // One service-role client shared by the jobs store and the real produce/reconcile
  // wiring (asset store, storage port, listing lookup, source-photo downloads) — all
  // server/worker-only (createService() — never exposed to a browser context).
  const client = createService();
  const jobsStore: JobsStore = new SupabaseJobsStore(client);
  const { produce, reconcile } = buildRealWorkerDeps(client);

  const pipelineDeps: PipelineDeps = {
    jobs: jobsStore,
    now: () => Date.now(),
    // setState (jobs.ts) already refreshes heartbeat_at on every active-state
    // transition; a dedicated heartbeat touch matters once a single stage can run long
    // without an intermediate transition (a real Sandbox render can take minutes).
    // No-op here — no real render has reached this path yet (see the header comment).
    heartbeat: async () => {},
    // Gate D1: real idempotency-key-based Asset lookup (src/lib/video-engine/
    // worker-deps.ts#buildRealReconcile) — a retried job adopts a prior attempt's
    // already-persisted Asset instead of re-rendering/re-uploading it.
    reconcile,
    capture: capturePipelineError,
    // Gate D1: real produceVideoAsset wiring (src/lib/video-engine/worker-deps.ts#
    // buildRealProduce) — resolves the listing + its photo Assets, downloads them via
    // short-lived signed URLs, renders through SandboxRemotionProvider, runs ffprobe
    // QA, and persists through the real Supabase Storage/Asset adapters.
    produce,
  };

  return {
    jobs: jobsStore,
    now: () => Date.now(),
    workerId: `cron-${process.env.VERCEL_REGION ?? "local"}-${process.pid}`,
    runJob: (job) => processJob(job, pipelineDeps),
    recoverAbandoned: (nowMs, staleMs) => recoverAbandoned(jobsStore, nowMs, staleMs),
    maxJobsPerRun: creativeVideoConfig.maxJobsPerRun,
    maxConcurrency: creativeVideoConfig.maxConcurrency,
    timeBudgetMs: creativeVideoConfig.workerTimeBudgetMs,
    staleAfterMs: creativeVideoConfig.staleAfterMs,
  };
}

async function handleWorkerRequest(req: Request): Promise<Response> {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runWorker(defaultRunDeps());
    return NextResponse.json(summary, { status: 200 });
  } catch {
    // Never leak a stack trace or internal error detail in the response.
    return NextResponse.json({ error: "worker_run_failed" }, { status: 500 });
  }
}

// Vercel Cron issues a GET; POST is kept for a manual/local trigger under the same
// secret. Both run the identical, fully-guarded handler.
export const GET = handleWorkerRequest;
export const POST = handleWorkerRequest;

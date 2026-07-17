// Gate C1's durable orchestrator (docs/superpowers/plans/2026-07-15-creative-studio-p2-
// video.md, Task 6, "Pipeline — wire produceVideoAsset into the job lifecycle"). This is
// the ONLY module in src/lib/video-engine allowed to import @/lib/creative-jobs (see the
// exception carved out in produce-asset.test.ts's module-isolation test) — its entire
// job is to bridge produceVideoAsset's pure `RenderResult`/`onStage` contract to
// Creative Job state transitions, error codes, and Sentry capture, WITHOUT
// produceVideoAsset itself ever knowing a job exists.
//
// CODE ONLY as of this commit (Gate C1): no real Sandbox, no real DB, no UI. Every dep
// is injected and every test in pipeline.test.ts uses fakes.
import type { CreativeJobErrorCode } from "@/lib/creative-jobs/errors";
import { setState, type CreativeJob, type JobsStore } from "@/lib/creative-jobs/jobs";
import { capturePipelineError, type PipelineErrorContext } from "@/lib/observability/sentry.server";
import {
  AssetDownloadFailedError,
  AssetPersistFailedError,
  RenderQaFailedError,
  StorageUploadFailedError,
  StorageVerifyFailedError,
  type RenderResult,
} from "@/lib/video-engine/produce-asset";
import { SandboxCreateFailedError } from "@/lib/video-engine/render-provider";
import { RENDER_PROVIDER, TEMPLATE_VERSION } from "@/lib/video-engine/versions";
import type { Asset } from "@/lib/assets/types";

// What the pipeline hands to `produce` — deliberately just the CreativeJob's own
// identity fields (id/listingId/ownerId/traceId). Resolving `sourceAssets`/`inputProps`
// from `listingId` is the real bound `produce` function's job (Gate C2 wiring, out of
// scope here) — this module never reaches into listing/photo data itself.
export interface PipelineProduceInput {
  jobId: string;
  listingId: string;
  ownerId: string;
  traceId: string | null;
}

export type OnStageHook = (stage: "rendering" | "qa" | "uploading") => void | Promise<void>;

export interface ReconcileResult {
  // True when a PRIOR attempt for this job already persisted the Asset + Storage
  // object (matched via the job's idempotency key) — retry safety: adopt it, do NOT
  // re-render/re-upload/duplicate.
  alreadyDone: boolean;
  asset?: Asset;
}

export interface PipelineDeps {
  jobs: JobsStore;
  produce: (input: PipelineProduceInput, hooks: { onStage: OnStageHook }) => Promise<RenderResult>;
  now: () => number;
  heartbeat: (jobId: string) => Promise<void>;
  reconcile: (job: CreativeJob) => Promise<ReconcileResult>;
  capture: typeof capturePipelineError;
}

// Internal only — never reaches a caller. Thrown from inside the `onStage` hook to
// unwind out of `deps.produce` the moment cancellation is observed at a checkpoint that
// still has a legal `-> cancelled` edge (see the comment on the "qa" checkpoint below).
class JobCancelledSentinel extends Error {}

type Stage = "download" | "rendering" | "qa" | "uploading";

// Maps a thrown error to a stable CreativeJobErrorCode. Typed errors (instanceof) are
// checked FIRST and are authoritative regardless of which stage was last announced —
// produceVideoAsset tags each of its own internal failure points with a distinct error
// class (src/lib/video-engine/produce-asset.ts), and SandboxRemotionProvider does the
// same for Sandbox provisioning (render-provider.ts). Only a genuinely untyped/unknown
// error (one produceVideoAsset itself didn't wrap — e.g. whatever the render provider's
// `render()` throws on a plain render failure) falls through to the stage-based default.
function classifyThrown(err: unknown, stage: Stage): CreativeJobErrorCode {
  if (err instanceof RenderQaFailedError) return "TECHNICAL_QA_FAILED";
  if (err instanceof AssetDownloadFailedError) return "ASSET_DOWNLOAD_FAILED";
  if (err instanceof StorageUploadFailedError) return "STORAGE_UPLOAD_FAILED";
  if (err instanceof StorageVerifyFailedError) return "STORAGE_VERIFY_FAILED";
  if (err instanceof AssetPersistFailedError) return "ASSET_CREATE_FAILED";
  if (err instanceof SandboxCreateFailedError) return "SANDBOX_CREATE_FAILED";

  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "RENDER_TIMEOUT";

  switch (stage) {
    case "download":
      return "ASSET_DOWNLOAD_FAILED";
    case "qa":
      return "TECHNICAL_QA_FAILED";
    case "uploading":
      return "STORAGE_UPLOAD_FAILED"; // best-effort default within this bucket
    case "rendering":
    default:
      return "RENDER_FAILED";
  }
}

// Never persists a signed URL/manifest/raw provider body — just the message, truncated,
// with the two most likely leak shapes (a URL, an sb_secret_ token) redacted as
// defense-in-depth. This is what lands in `creative_jobs.error_message`, a field
// visible to admin/support tooling (never to the seller — see Task 8's two-level
// status), so it stays technical-detail-only, never raw provider output.
function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/https?:\/\/\S+/gi, "[url omitted]")
    .replace(/sb_secret_\S+/gi, "[secret omitted]")
    .slice(0, 500);
}

async function fastForwardToCompleted(
  deps: PipelineDeps,
  job: CreativeJob,
  attempt: number,
  asset: Asset | null,
): Promise<CreativeJob> {
  // A retried job is reconciled straight to `completed` WITHOUT calling `deps.produce`
  // again (no duplicate render/upload) — but the transition log still walks the real
  // legal edges (rendering -> qa -> uploading -> completed) so the audit trail stays
  // honest about what state the job passed through, just tagged `reconciled: true`.
  const metaBase = { actor: "worker" as const, attempt, capability: job.capability, metadata: { reconciled: true } };
  await deps.heartbeat(job.id);
  await setState(deps.jobs, job.id, "rendering", { ...metaBase, nowMs: deps.now() });
  await setState(deps.jobs, job.id, "qa", { ...metaBase, nowMs: deps.now() });
  await setState(deps.jobs, job.id, "uploading", { ...metaBase, nowMs: deps.now() });
  return setState(deps.jobs, job.id, "completed", {
    ...metaBase,
    nowMs: deps.now(),
    assetId: asset?.id ?? job.assetId ?? null,
  });
}

// Processes ONE already-claimed job. Precondition: `job.state === "running"` — the
// worker's `claimNextQueued` call already performed that transition atomically before
// handing the job here (see src/lib/creative-jobs/jobs.ts). Sets states AS FACTS BECOME
// TRUE: running (already true on entry) -> rendering (just before the provider) -> qa
// (after render, before QA) -> uploading (QA passed, through checksum/upload/read-
// verify/createAsset) -> completed (ONLY after the Asset row + transition are
// persisted). Never throws — every outcome (success, a classified failure, or
// cancellation) resolves to the job's final CreativeJob row.
export async function processJob(job: CreativeJob, deps: PipelineDeps): Promise<CreativeJob> {
  if (job.state !== "running") {
    throw new Error(`processJob: expected a freshly-claimed job in 'running' state, got '${job.state}'`);
  }

  await deps.heartbeat(job.id);

  // Retry reconciliation FIRST — before any render/upload work — so a job whose prior
  // attempt already persisted the Asset+object never duplicates either.
  // This is also what makes it safe for `recoverAbandoned` (src/lib/creative-jobs/
  // jobs.ts) to requeue a job that went stale mid-'uploading' or mid-'qa', not just
  // mid-'rendering': the prior attempt may have already uploaded and/or persisted the
  // Asset before the worker died, and reconciliation (matched on the job's idempotency
  // key/traceId) adopts that instead of re-rendering/re-uploading/duplicating it.
  const reconciled = await deps.reconcile(job);
  const attempt = job.attempts + 1;
  if (reconciled.alreadyDone) {
    return fastForwardToCompleted(deps, job, attempt, reconciled.asset ?? null);
  }

  // Cancel "before Sandbox creation" — the job is still 'running' here, which has a
  // legal -> cancelled edge (see LEGAL_TRANSITIONS in states.ts).
  const freshBeforeRender = await deps.jobs.getJob(job.id);
  if (freshBeforeRender?.cancellationRequested) {
    return setState(deps.jobs, job.id, "cancelled", {
      actor: "system",
      nowMs: deps.now(),
      attempt,
      metadata: { reason: "cancellation_requested" },
    });
  }

  let currentStage: Stage = "download";

  const onStage: OnStageHook = async (stage) => {
    if (stage === "qa") {
      // Cancel "during render" — this fires right after render output exists but
      // BEFORE the rendering -> qa transition, i.e. the job is still 'rendering' here,
      // the LAST state with a legal -> cancelled edge (qa/uploading have none —
      // finishing a nearly-done render/upload is preferable to a half-cancelled one).
      const fresh = await deps.jobs.getJob(job.id);
      if (fresh?.cancellationRequested) {
        await setState(deps.jobs, job.id, "cancelled", {
          actor: "system",
          nowMs: deps.now(),
          attempt,
          metadata: { reason: "cancellation_requested" },
        });
        throw new JobCancelledSentinel();
      }
    }
    currentStage = stage;
    await deps.heartbeat(job.id);
    await setState(deps.jobs, job.id, stage, { actor: "worker", nowMs: deps.now(), attempt, capability: job.capability });
  };

  let result: RenderResult;
  try {
    result = await deps.produce(
      { jobId: job.id, listingId: job.listingId, ownerId: job.ownerId, traceId: job.traceId ?? null },
      { onStage },
    );
  } catch (err) {
    if (err instanceof JobCancelledSentinel) {
      const fresh = await deps.jobs.getJob(job.id);
      return fresh ?? job;
    }

    const errorCode = classifyThrown(err, currentStage);
    const message = sanitizeErrorMessage(err);
    const failed = await setState(deps.jobs, job.id, "failed", {
      actor: "worker",
      nowMs: deps.now(),
      attempt,
      capability: job.capability,
      error: { code: errorCode, message },
    });

    const ctx: PipelineErrorContext = {
      traceId: job.traceId ?? null,
      jobId: job.id,
      stage: currentStage,
      errorCode,
      attempt,
      renderProvider: RENDER_PROVIDER,
      templateVersion: TEMPLATE_VERSION,
    };
    // Sentry gets a GENERIC, code-derived message ONLY — never `message` (the sanitized
    // detail persisted to the DB above) and never the raw `err`. A regex-based scrubber
    // (URLs, `sb_secret_...`, bearer tokens) cannot reliably catch every leak shape — an
    // address embedded in a thrown error's text sails straight through it — so the only
    // structurally safe contract is to never echo ANY error-derived text to a
    // third-party observability vendor. `errorCode` is a stable, closed-set
    // `CreativeJobErrorCode`, so it carries no PII by construction.
    // sentry.server.ts's `capturePipelineError` additionally ignores this argument's
    // content entirely and rebuilds the same generic string itself from `ctx.errorCode`
    // — defense-in-depth in case a future caller passes something richer here.
    deps.capture(new Error(`Creative job failed: ${errorCode}`), ctx);

    return failed;
  }

  // `completed` ONLY after the Asset row + this transition are persisted — `setState`
  // below IS that persistence (it appends the transition after `updateJob`; see
  // jobs.ts#setState). A failed render/QA/upload never reaches this line.
  //
  // Gate D1 ("Metrics / observability"): the separated `RenderMetrics` (never one
  // total — sandboxStartupMs/assetDownloadMs/bundleMs/selectCompositionMs/renderMs/
  // qaMs/uploadMs/totalMs/outputBytes/estimatedCostUsd) land in THIS transition's
  // `metadata` jsonb column, alongside the existing `cost`/`provider` fields. The DB
  // transition log stays the source of truth (see getJobTimeline,
  // src/lib/creative-jobs/timeline.ts, for the admin-only read of this data) — no
  // separate metrics store.
  return setState(deps.jobs, job.id, "completed", {
    actor: "worker",
    nowMs: deps.now(),
    attempt,
    capability: job.capability,
    assetId: result.outputAsset.id,
    provider: result.provenance.renderProvider,
    cost: { amountUsd: result.metrics.estimatedCostUsd, provider: result.provenance.renderProvider },
    metadata: { metrics: result.metrics },
  });
}

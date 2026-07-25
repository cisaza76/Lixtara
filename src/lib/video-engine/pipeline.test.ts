import { describe, expect, it, vi } from "vitest";
import type { CreativeJob, JobsStore, StoredTransition } from "@/lib/creative-jobs/jobs";
import type { JobTransition } from "@/lib/creative-jobs/states";
import type { Asset } from "@/lib/assets/types";
import {
  AssetDownloadFailedError,
  AssetPersistFailedError,
  RenderQaFailedError,
  StorageUploadFailedError,
  StorageVerifyFailedError,
  type RenderResult,
} from "@/lib/video-engine/produce-asset";
import { SandboxCreateFailedError } from "@/lib/video-engine/render-provider";
import { processJob, type PipelineDeps, type ReconcileResult } from "@/lib/video-engine/pipeline";

// ---- fake JobsStore (same DB-mimicking semantics as jobs.test.ts's fake) -----------

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
    async findActiveByIdempotencyKey() {
      return null;
    },
    async findLatestByListing(listingId) {
      const matches = jobs
        .filter((j) => j.listingId === listingId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return matches[0] ? { ...matches[0] } : null;
    },
    async findOldestQueued() {
      return null;
    },
    async claimQueued() {
      return null;
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
    async listStaleActive() {
      return [];
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

const NOW_BASE = 1_700_000_000_000;

function runningJob(overrides: Partial<CreativeJob> = {}): CreativeJob {
  return {
    id: "job-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    capability: "video",
    state: "running",
    assetId: null,
    idempotencyKey: "idem-1",
    attempts: 0,
    maxAttempts: 3,
    claimedAt: new Date(NOW_BASE).toISOString(),
    claimedBy: "worker-1",
    heartbeatAt: new Date(NOW_BASE).toISOString(),
    cancellationRequested: false,
    timeoutMs: 600_000,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(NOW_BASE - 1000).toISOString(),
    updatedAt: new Date(NOW_BASE).toISOString(),
    traceId: "trace-1",
    ...overrides,
  };
}

function fakeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "video-asset-1",
    listingId: "listing-1",
    ownerId: "owner-1",
    kind: "video",
    version: 1,
    parentAsset: null,
    sourceType: "generated",
    sourceId: null,
    provenance: { sourceAssetIds: [], capability: "video", engine: "video-engine", provider: "remotion", prompt: null },
    storageBucket: "creative-renders",
    storagePath: "listing-1/video/trace-1.mp4",
    checksum: "abc123",
    bytes: 1234,
    mime: "video/mp4",
    costUsd: 0.01,
    costProvider: "vercel-sandbox",
    createdBy: "owner-1",
    lifecycle: "ready_for_review",
    qa: null,
    policy: null,
    createdAt: new Date(NOW_BASE).toISOString(),
    ...overrides,
  };
}

function okRenderResult(): RenderResult {
  return {
    outputAsset: fakeAsset(),
    technicalQa: {
      ok: true,
      container: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      fps: "30/1",
      durationSec: 6.5,
      bytes: 1234,
      checksumSha256: "abc123",
      checks: {},
    },
    metrics: {
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
    },
    provenance: {
      sourceAssetIds: ["photo-1"],
      templateId: "ListingVideo",
      templateVersion: "1",
      bundleVersion: "bundle-v1",
      inputSchemaVersion: "1",
      rendererVersion: "4.0.489",
      renderProvider: "vercel-sandbox",
      traceId: "trace-1",
    },
  };
}

function noReconcile(): ReconcileResult {
  return { alreadyDone: false };
}

function buildDeps(
  store: JobsStore,
  over: Partial<PipelineDeps> = {},
): { deps: PipelineDeps; heartbeatCalls: string[]; captureCalls: unknown[][] } {
  const heartbeatCalls: string[] = [];
  const captureCalls: unknown[][] = [];
  let n = NOW_BASE + 1;
  const deps: PipelineDeps = {
    jobs: store,
    produce: async (_input, hooks) => {
      await hooks.onStage("rendering");
      await hooks.onStage("qa");
      await hooks.onStage("uploading");
      return okRenderResult();
    },
    now: () => n++,
    heartbeat: async (jobId) => {
      heartbeatCalls.push(jobId);
    },
    reconcile: async () => noReconcile(),
    capture: (err, ctx) => {
      captureCalls.push([err, ctx]);
    },
    ...over,
  };
  return { deps, heartbeatCalls, captureCalls };
}

// ---- happy path -------------------------------------------------------------------

describe("processJob — happy path", () => {
  it("transitions running -> rendering -> qa -> uploading -> completed, in the NEW order", async () => {
    const store = fakeJobsStore([runningJob()]);
    const { deps } = buildDeps(store);

    const result = await processJob(runningJob(), deps);

    expect(result.state).toBe("completed");
    const seenStates = store.transitions.map((t) => t.to);
    expect(seenStates).toEqual(["rendering", "qa", "uploading", "completed"]);
  });

  it("sets the Asset id on the job only once completed", async () => {
    const store = fakeJobsStore([runningJob()]);
    const { deps } = buildDeps(store);

    const result = await processJob(runningJob(), deps);

    expect(result.assetId).toBe("video-asset-1");
  });

  it("calls heartbeat at least once per active-state entry", async () => {
    const store = fakeJobsStore([runningJob()]);
    const { deps, heartbeatCalls } = buildDeps(store);

    await processJob(runningJob(), deps);

    // top-of-job + rendering + qa + uploading = 4 checkpoints minimum.
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(4);
    expect(heartbeatCalls.every((id) => id === "job-1")).toBe(true);
  });

  it("never calls capture on success", async () => {
    const store = fakeJobsStore([runningJob()]);
    const { deps, captureCalls } = buildDeps(store);

    await processJob(runningJob(), deps);

    expect(captureCalls).toHaveLength(0);
  });

  // Gate D1 ("Metrics / observability"): the separated RenderMetrics (+ cost) persist
  // onto the completed transition's metadata jsonb, not just a job-level total — an
  // admin timeline read (getJobTimeline, src/lib/creative-jobs/timeline.ts) recovers
  // them from there.
  it("persists the RenderResult's separated metrics onto the completed transition's metadata", async () => {
    const store = fakeJobsStore([runningJob()]);
    const { deps } = buildDeps(store);

    await processJob(runningJob(), deps);

    const completedTransition = store.transitions.find((t) => t.to === "completed");
    expect(completedTransition?.metadata?.metrics).toEqual(okRenderResult().metrics);
    expect(completedTransition?.costUsd).toBe(okRenderResult().metrics.estimatedCostUsd);
    expect(completedTransition?.provider).toBe("vercel-sandbox");
  });

  it("throws if handed a job that isn't already 'running'", async () => {
    const store = fakeJobsStore([runningJob({ state: "queued" })]);
    const { deps } = buildDeps(store);

    await expect(processJob(runningJob({ state: "queued" }), deps)).rejects.toThrow(/running/);
  });
});

// ---- per-stage failure -> correct error_code + classification ---------------------

describe("processJob — failure classification (no partial/completed Asset)", () => {
  async function runFailing(produce: PipelineDeps["produce"]) {
    const store = fakeJobsStore([runningJob()]);
    const { deps, captureCalls } = buildDeps(store, { produce });
    const result = await processJob(runningJob(), deps);
    return { result, store, captureCalls };
  }

  it("download failure -> ASSET_DOWNLOAD_FAILED", async () => {
    const { result, captureCalls } = await runFailing(async () => {
      throw new AssetDownloadFailedError("network blip");
    });
    expect(result.state).toBe("failed");
    expect(result.errorCode).toBe("ASSET_DOWNLOAD_FAILED");
    expect(result.assetId).toBeNull();
    expect(captureCalls).toHaveLength(1);
    expect((captureCalls[0][1] as { errorCode: string }).errorCode).toBe("ASSET_DOWNLOAD_FAILED");
  });

  it("a generic render failure (untyped) -> RENDER_FAILED", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      throw new Error("render exploded");
    });
    expect(result.state).toBe("failed");
    expect(result.errorCode).toBe("RENDER_FAILED");
  });

  it("Sandbox provisioning failure -> SANDBOX_CREATE_FAILED (typed, regardless of stage default)", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      throw new SandboxCreateFailedError("could not provision sandbox");
    });
    expect(result.errorCode).toBe("SANDBOX_CREATE_FAILED");
  });

  it("a render timeout (message-based) -> RENDER_TIMEOUT", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      throw new Error("render timed out after 300000ms");
    });
    expect(result.errorCode).toBe("RENDER_TIMEOUT");
  });

  it("QA failure -> TECHNICAL_QA_FAILED", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      await hooks.onStage("qa");
      throw new RenderQaFailedError({
        ok: false,
        container: "mp4",
        codec: "h265",
        width: 1920,
        height: 1080,
        fps: "30/1",
        durationSec: 6.5,
        bytes: 1234,
        checksumSha256: "x",
        checks: { codec: false },
      });
    });
    expect(result.errorCode).toBe("TECHNICAL_QA_FAILED");
  });

  it("upload failure -> STORAGE_UPLOAD_FAILED", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      await hooks.onStage("qa");
      await hooks.onStage("uploading");
      throw new StorageUploadFailedError("fake storage: upload failed");
    });
    expect(result.errorCode).toBe("STORAGE_UPLOAD_FAILED");
  });

  it("read-verify failure -> STORAGE_VERIFY_FAILED", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      await hooks.onStage("qa");
      await hooks.onStage("uploading");
      throw new StorageVerifyFailedError("uploaded render failed read-verify");
    });
    expect(result.errorCode).toBe("STORAGE_VERIFY_FAILED");
  });

  it("Asset persistence failure -> ASSET_CREATE_FAILED", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      await hooks.onStage("qa");
      await hooks.onStage("uploading");
      throw new AssetPersistFailedError("insert failed");
    });
    expect(result.errorCode).toBe("ASSET_CREATE_FAILED");
  });

  it("no failure path ever sets assetId or reaches 'completed'", async () => {
    const { result } = await runFailing(async (_input, hooks) => {
      await hooks.onStage("rendering");
      throw new Error("boom");
    });
    expect(result.state).not.toBe("completed");
    expect(result.assetId).toBeNull();
  });
});

// ---- retry reconciliation -----------------------------------------------------------

describe("processJob — retry reconciliation", () => {
  it("a job whose reconcile says alreadyDone goes straight to completed with no produce call / no second Asset", async () => {
    const store = fakeJobsStore([runningJob({ attempts: 1 })]);
    const priorAsset = fakeAsset({ id: "video-asset-PRIOR" });
    const produce = vi.fn();
    const { deps } = buildDeps(store, {
      produce,
      reconcile: async () => ({ alreadyDone: true, asset: priorAsset }),
    });

    const result = await processJob(runningJob({ attempts: 1 }), deps);

    expect(produce).not.toHaveBeenCalled();
    expect(result.state).toBe("completed");
    expect(result.assetId).toBe("video-asset-PRIOR");
    // Still walks the real transition log (tagged reconciled) rather than jumping the
    // illegal running -> completed edge directly.
    expect(store.transitions.map((t) => t.to)).toEqual(["rendering", "qa", "uploading", "completed"]);
    expect(store.transitions.every((t) => t.metadata?.reconciled === true)).toBe(true);
  });

  it("reconciliation with no returned asset falls back to the job's existing assetId", async () => {
    const store = fakeJobsStore([runningJob({ assetId: "video-asset-EXISTING" })]);
    const { deps } = buildDeps(store, { reconcile: async () => ({ alreadyDone: true }) });

    const result = await processJob(runningJob({ assetId: "video-asset-EXISTING" }), deps);

    expect(result.assetId).toBe("video-asset-EXISTING");
  });

  // Gate C2 fix: src/lib/creative-jobs/jobs.ts#recoverAbandoned now requeues a job that
  // went stale mid-'uploading' or mid-'qa' (previously only running/rendering were
  // recovered, stranding those jobs). This is the requeue -> reclaim -> reprocess path:
  // the worker's next attempt re-enters here as a freshly-claimed 'running' job with
  // attempts bumped (recoverAbandoned's requeue increments it) — reconciliation must
  // still adopt the prior attempt's already-uploaded/persisted Asset instead of
  // re-rendering/re-uploading/duplicating it, exactly like any other retried attempt.
  it("a job reclaimed after recoverAbandoned requeued it out of a stale 'uploading'/'qa' state reconciles to the prior Asset with no re-render/re-upload/duplicate", async () => {
    const priorAsset = fakeAsset({ id: "video-asset-PRIOR-UPLOAD" });
    // attempts: 1 mirrors what recoverAbandoned's requeue produces (attemptsBefore(0) ->
    // nextAttempt(1)) after the job is reclaimed and handed back to processJob.
    const store = fakeJobsStore([runningJob({ attempts: 1 })]);
    const produce = vi.fn();
    const { deps } = buildDeps(store, {
      produce,
      reconcile: async () => ({ alreadyDone: true, asset: priorAsset }),
    });

    const result = await processJob(runningJob({ attempts: 1 }), deps);

    expect(produce).not.toHaveBeenCalled(); // no re-render, no re-upload
    expect(result.state).toBe("completed");
    expect(result.assetId).toBe("video-asset-PRIOR-UPLOAD"); // adopted, not duplicated
  });
});

// ---- cancellation mid-flight ---------------------------------------------------------

describe("processJob — cancellation mid-flight", () => {
  it("cancels before Sandbox creation (still 'running') without ever calling produce", async () => {
    const store = fakeJobsStore([runningJob({ cancellationRequested: true })]);
    const produce = vi.fn();
    const { deps, captureCalls } = buildDeps(store, { produce });

    const result = await processJob(runningJob({ cancellationRequested: true }), deps);

    expect(produce).not.toHaveBeenCalled();
    expect(result.state).toBe("cancelled");
    expect(captureCalls).toHaveLength(0);
  });

  it("cancels during render (before the qa transition) and stops progression — never reaches uploading/completed", async () => {
    const store = fakeJobsStore([runningJob()]);
    let sawUploading = false;
    const produce: PipelineDeps["produce"] = async (_input, hooks) => {
      await hooks.onStage("rendering");
      // Cancellation arrives WHILE this job is 'rendering' — simulated by flipping the
      // flag directly on the store (as a concurrent `requestCancel` call would).
      const row = store.jobs.find((j) => j.id === "job-1");
      if (row) row.cancellationRequested = true;
      await hooks.onStage("qa"); // this call is expected to throw (cancellation checkpoint)
      sawUploading = true;
      await hooks.onStage("uploading");
      return okRenderResult();
    };
    const { deps, captureCalls } = buildDeps(store, { produce });

    const result = await processJob(runningJob(), deps);

    expect(sawUploading).toBe(false);
    expect(result.state).toBe("cancelled");
    expect(store.transitions.map((t) => t.to)).toEqual(["rendering", "cancelled"]);
    expect(captureCalls).toHaveLength(0);
  });
});

// ---- Sentry capture never leaks sensitive detail — DB message is sanitized, Sentry
// message is generic and code-derived (never an echo of any error content, sanitized or
// not — a regex scrubber cannot reliably catch every PII shape, e.g. a street address).

// Secret-scanning hygiene: assemble the fake secret at runtime so no full Supabase secret-key
// literal exists in source (avoids GitHub Push Protection false positives); the runtime
// value and the redaction assertions below are unchanged.
const FAKE_SECRET = ["sb", "secret", "deadbeef"].join("_");

describe("processJob — sanitized failure detail", () => {
  it("redacts a URL/secret embedded in a thrown error's message before storing it, and still captures once", async () => {
    const store = fakeJobsStore([runningJob()]);
    const { deps, captureCalls } = buildDeps(store, {
      produce: async () => {
        throw new AssetDownloadFailedError(
          `failed fetching https://example.supabase.co/object/sign/x?token=abc using ${FAKE_SECRET}`,
        );
      },
    });

    const result = await processJob(runningJob(), deps);

    expect(result.errorMessage).not.toMatch(/https?:\/\//);
    expect(result.errorMessage).not.toContain(FAKE_SECRET);
    expect(captureCalls).toHaveLength(1);
  });

  it("hands capture() a GENERIC, code-derived error — NEVER the raw error, and NOT even the sanitized DB message; the first argument carries no error-derived content at all", async () => {
    const store = fakeJobsStore([runningJob()]);
    const rawErr = new AssetDownloadFailedError(
      `failed fetching https://example.supabase.co/object/sign/x?token=abc using ${FAKE_SECRET} at 123 Ocean Dr, Miami Beach, FL 33139`,
    );
    (rawErr as Error & { cause?: unknown }).cause = new Error(`raw cause: ${FAKE_SECRET}`);
    const { deps, captureCalls } = buildDeps(store, {
      produce: async () => {
        throw rawErr;
      },
    });

    const result = await processJob(runningJob(), deps);

    expect(captureCalls).toHaveLength(1);
    const forwardedErr = captureCalls[0][0] as Error;
    const forwardedCtx = captureCalls[0][1] as { errorCode: string };
    expect(forwardedErr).toBeInstanceOf(Error);
    expect(forwardedErr).not.toBe(rawErr); // never the raw error object itself
    // Exactly the generic, code-derived string — not the sanitized DB message either,
    // even though that message is itself already scrubbed of URL/secret patterns.
    expect(forwardedErr.message).toBe(`Creative job failed: ${forwardedCtx.errorCode}`);
    expect(forwardedErr.message).toMatch(/^Creative job failed: [A-Z_]+$/);
    expect(forwardedErr.message).not.toBe(result.errorMessage);
    expect(forwardedErr.message).not.toMatch(/https?:\/\//);
    expect(forwardedErr.message).not.toContain(FAKE_SECRET);
    expect(forwardedErr.message).not.toContain("Ocean Dr");
    expect(forwardedErr.message).not.toContain("Miami Beach");
    expect((forwardedErr as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

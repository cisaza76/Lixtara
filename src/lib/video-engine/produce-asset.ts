// The Video Engine's orchestrator: source Assets -> Sandbox/Remotion -> ffprobe QA ->
// SHA-256 -> Supabase Storage -> a new, immutable, versioned video Asset. QA runs on
// the ffprobe JSON the render provider already captured INSIDE the Sandbox
// (render-provider.ts's `RenderMediaOutput.ffprobeJson`) — this module never writes a
// local temp mp4 or shells out to a host ffprobe binary. This module has NO import of
// `@/lib/creative-jobs` (grep-enforced by produce-asset.test.ts) — it never decides
// `completed`/`failed`/`approved`/`published`. Those are Creative Job
// state-machine calls the Task-6 orchestrator makes AFTER reading this function's
// `RenderResult`; this module's only job is to produce a valid, auditable Asset (or
// throw and leave nothing half-created).
import { createHash } from "node:crypto";
import { createAsset } from "@/lib/assets/asset-manager";
import type { Asset, AssetProvenance, AssetStore } from "@/lib/assets/types";
import { contentTypeFromQa, type ExpectedTechnicalSpec, type TechnicalQaResult } from "@/lib/video-engine/qa";
import type { RenderProvider } from "@/lib/video-engine/render-provider";
import type { StoragePort } from "@/lib/video-engine/storage-port";
import {
  INPUT_SCHEMA_VERSION,
  RENDERER_VERSION,
  RENDER_PROVIDER,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
} from "@/lib/video-engine/versions";
import { totalDurationFrames } from "@/remotion/input";
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/remotion/layout";

export interface RenderProvenance {
  sourceAssetIds: string[];
  templateId: string;
  templateVersion: string;
  bundleVersion: string;
  inputSchemaVersion: string;
  rendererVersion: string;
  renderProvider: string;
  traceId: string | null;
}

export interface RenderMetrics {
  sandboxStartupMs: number;
  assetDownloadMs: number;
  bundleMs: number;
  selectCompositionMs: number;
  renderMs: number;
  qaMs: number;
  uploadMs: number;
  totalMs: number;
  outputBytes: number;
  estimatedCostUsd: number;
}

export interface RenderResult {
  outputAsset: Asset;
  technicalQa: TechnicalQaResult;
  metrics: RenderMetrics;
  provenance: RenderProvenance;
}

export interface ProduceVideoAssetInput {
  listingId: string;
  ownerId: string;
  sourceAssets: Asset[];
  inputProps: unknown;
  traceId: string | null;
}

export interface ProduceVideoAssetDeps {
  render: RenderProvider;
  // Parses the render provider's in-sandbox-captured `ffprobeJson` (never a host-local
  // ffprobe spawn — see render-provider.ts's `RenderMediaOutput.ffprobeJson` and
  // worker-deps.ts's `defaultRunQa`). `bytes` is the actual rendered buffer, passed
  // through unchanged so the real implementation's checksum/bytesPositive checks
  // (qa.ts's `parseFfprobe`) still verify the real bytes, never ffprobe's own claims.
  runQa: (ffprobeJson: string, bytes: Buffer, expected: ExpectedTechnicalSpec) => Promise<TechnicalQaResult>;
  storage: StoragePort;
  assets: AssetStore;
  downloadAssets: (assets: Asset[]) => Promise<string[]>;
  now: () => number;
  // OPTIONAL, pure callback — fired "as facts become true" so an orchestrator (Gate C1's
  // src/lib/video-engine/pipeline.ts) can set Creative Job state without this module
  // importing anything from @/lib/creative-jobs (see the module isolation test in
  // produce-asset.test.ts). Called AT MOST once per stage, in order: "rendering" (just
  // before deps.render.render — download has already happened), "qa" (right after
  // render succeeds, before deps.runQa), "uploading" (right after QA passes, before
  // checksum/upload/read-verify/createAsset). No hook fires for a stage that never
  // starts (e.g. QA failing means "uploading" is never announced).
  onStage?: (stage: "rendering" | "qa" | "uploading") => void | Promise<void>;
}

// `AssetProvenance` (src/lib/assets/types.ts) is intentionally narrow
// (sourceAssetIds/capability/engine/provider/prompt) — see
// docs/superpowers/specs/2026-07-15-asset-manager-design.md §3. The render pipeline's
// audit trail needs more (which template/bundle/renderer/trace produced this exact
// file). This type is a structural superset of BOTH, so it satisfies `createAsset`'s
// existing `AssetProvenance` contract unchanged while the Asset row's `provenance`
// column literally carries all 8 `RenderProvenance` fields too — reconstructable
// straight from the Asset, not only from this function's return value.
export interface AssetVideoProvenance extends AssetProvenance, RenderProvenance {}

export class RenderQaFailedError extends Error {
  constructor(public readonly qa: TechnicalQaResult) {
    super(`produceVideoAsset: technical QA failed — checks: ${JSON.stringify(qa.checks)}`);
    this.name = "RenderQaFailedError";
  }
}

// Typed, per-stage failure markers. Each wraps the ORIGINAL error's message VERBATIM
// (never rewritten) so any caller matching on message text (produce-asset.test.ts's
// `.rejects.toThrow(/upload failed/)` etc.) keeps working unchanged — these classes
// exist purely so a downstream orchestrator (pipeline.ts) can map a thrown error to the
// right `CreativeJobErrorCode` via `instanceof`, without string-sniffing and without
// this module importing anything from @/lib/creative-jobs (same isolation guarantee as
// RenderQaFailedError above).
export class AssetDownloadFailedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AssetDownloadFailedError";
  }
}

export class StorageUploadFailedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageUploadFailedError";
  }
}

export class StorageVerifyFailedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageVerifyFailedError";
  }
}

export class AssetPersistFailedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AssetPersistFailedError";
  }
}

const DURATION_TOLERANCE_SEC = 2;

function expectedSpecFor(photoCount: number): ExpectedTechnicalSpec {
  const frames = totalDurationFrames(Math.max(photoCount, 1), FPS);
  return {
    container: "mp4",
    codec: "h264",
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    fps: FPS,
    durationSec: frames / FPS,
    toleranceSec: DURATION_TOLERANCE_SEC,
  };
}

function buildStoragePath(listingId: string, traceId: string | null, nowMs: number): string {
  const suffix = traceId ?? String(nowMs);
  return `${listingId}/video/${suffix}.mp4`;
}

// Rough Active-CPU cost estimate (see the P2.0 spike report §6: "~US$0.005-0.02 per
// video" on 4 vCPU). A real Sandbox billing readout is a strictly better source once
// wired (out of scope here — no real Sandbox is opened by this module's callers in
// unit tests); this keeps `estimatedCostUsd` non-fabricated-zero for a render that
// clearly cost something, without claiming billing precision it doesn't have.
const ASSUMED_VCPUS = 4;
const ACTIVE_CPU_RATE_USD_PER_VCPU_SECOND = 0.000_02;

function estimateCostUsd(
  metrics: Pick<RenderMetrics, "sandboxStartupMs" | "bundleMs" | "selectCompositionMs" | "renderMs">,
): number {
  const activeMs = metrics.sandboxStartupMs + metrics.bundleMs + metrics.selectCompositionMs + metrics.renderMs;
  const activeSeconds = activeMs / 1000;
  return Number((activeSeconds * ASSUMED_VCPUS * ACTIVE_CPU_RATE_USD_PER_VCPU_SECOND).toFixed(6));
}

// Persistence order is EXACT and load-bearing: render -> QA -> checksum -> upload ->
// read-verify -> createAsset. A failed QA or a failed upload/read-verify NEVER yields a
// created video Asset (throws before `deps.assets.insert` is ever called). If Asset
// creation itself fails AFTER a successful upload, the uploaded object is removed
// (orphan cleanup) and the original error is rethrown — never swallowed.
export async function produceVideoAsset(
  input: ProduceVideoAssetInput,
  deps: ProduceVideoAssetDeps,
): Promise<RenderResult> {
  const totalStart = deps.now();

  // 1. Download source Assets to a temp filesystem — render happens from LOCAL paths,
  // never a signed URL streamed through the whole render (requirement 3). No onStage
  // call yet: an orchestrator that never sees "rendering" fired can safely treat any
  // throw up to this point as a download failure.
  const downloadStart = deps.now();
  let localAssetPaths: string[];
  try {
    localAssetPaths = await deps.downloadAssets(input.sourceAssets);
  } catch (err) {
    throw new AssetDownloadFailedError(err instanceof Error ? err.message : String(err), err);
  }
  const assetDownloadMs = deps.now() - downloadStart;

  // 2. Render (temp, in-memory bytes — nothing persisted yet). "rendering" fires just
  // before the provider call, per the pipeline's stage contract.
  await deps.onStage?.("rendering");
  const renderOut = await deps.render.render({
    compositionId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    localAssetPaths,
    inputProps: input.inputProps,
    traceId: input.traceId,
  });

  // 3. QA BEFORE any Asset row exists (requirements 5 + 6). A failed QA never yields a
  // completed/created video Asset. "qa" fires right after render, before QA runs. The
  // ffprobe payload was captured INSIDE the render Sandbox (render-provider.ts,
  // `RenderMediaOutput.ffprobeJson`) — `deps.runQa` only ever PARSES it (the real
  // implementation, worker-deps.ts's `defaultRunQa`, calls the pure `parseFfprobe`);
  // there is no host-local ffprobe spawn anywhere in this path.
  await deps.onStage?.("qa");
  const qaStart = deps.now();
  const technicalQa = await deps.runQa(renderOut.ffprobeJson, renderOut.bytes, expectedSpecFor(input.sourceAssets.length));
  const qaMs = deps.now() - qaStart;
  if (!technicalQa.ok) {
    throw new RenderQaFailedError(technicalQa);
  }

  // 4. Checksum — the real SHA-256 of the actual bytes (never trusted from
  // ffprobe's own metadata; mirrors the Asset Manager's checksum rule). "uploading"
  // fires here: QA passed, everything from here through createAsset is one bucket.
  await deps.onStage?.("uploading");
  const checksumSha256 = createHash("sha256").update(renderOut.bytes).digest("hex");

  // 5. Upload. The Storage object's content-type comes from what ffprobe actually
  // detected (`technicalQa`, checked `.ok` above) — NEVER from the renderer's own
  // claimed `renderOut.mime`. ffprobe detects; that's what determines the stored
  // object's metadata, not the renderer's self-reported claim.
  const storagePath = buildStoragePath(input.listingId, input.traceId, deps.now());
  const uploadContentType = contentTypeFromQa(technicalQa);
  const uploadStart = deps.now();
  let uploaded: Awaited<ReturnType<StoragePort["upload"]>>;
  try {
    uploaded = await deps.storage.upload(storagePath, renderOut.bytes, uploadContentType);
  } catch (err) {
    throw new StorageUploadFailedError(err instanceof Error ? err.message : String(err), err);
  }
  const uploadMs = deps.now() - uploadStart;

  // 6. Read-verify — proves the object is actually retrievable before any Asset row
  // ever points at it. A failed read-verify (whether `readVerify` returns false OR
  // itself throws) is treated exactly like a failed upload: best-effort cleanup, no
  // Asset, throw.
  let verified: boolean;
  try {
    verified = await deps.storage.readVerify(uploaded.bucket, uploaded.path);
  } catch (err) {
    await deps.storage.remove(uploaded.bucket, uploaded.path).catch(() => {});
    throw new StorageVerifyFailedError(err instanceof Error ? err.message : String(err), err);
  }
  if (!verified) {
    await deps.storage.remove(uploaded.bucket, uploaded.path).catch(() => {});
    throw new StorageVerifyFailedError("produceVideoAsset: uploaded render failed read-verify");
  }

  // 7. Create the Asset. Full provenance (all 8 fields) on both the row and the
  // returned RenderResult (requirement 4).
  const provenance: RenderProvenance = {
    sourceAssetIds: input.sourceAssets.map((a) => a.id),
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    bundleVersion: renderOut.bundleVersion,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    rendererVersion: RENDERER_VERSION,
    renderProvider: RENDER_PROVIDER,
    traceId: input.traceId,
  };
  const assetProvenance: AssetVideoProvenance = {
    ...provenance,
    capability: "video",
    engine: "video-engine",
    provider: "remotion",
    prompt: null,
  };

  const metrics: RenderMetrics = {
    sandboxStartupMs: renderOut.metrics.sandboxStartupMs,
    assetDownloadMs,
    bundleMs: renderOut.metrics.bundleMs,
    selectCompositionMs: renderOut.metrics.selectCompositionMs,
    renderMs: renderOut.metrics.renderMs,
    qaMs,
    uploadMs,
    totalMs: 0, // set below, once total elapsed is known
    outputBytes: uploaded.bytes,
    estimatedCostUsd: estimateCostUsd(renderOut.metrics),
  };
  metrics.totalMs = deps.now() - totalStart;

  let outputAsset: Asset;
  try {
    outputAsset = await createAsset(deps.assets, {
      listingId: input.listingId,
      ownerId: input.ownerId,
      kind: "video",
      version: 1, // regeneration/version-chaining is out of Task 5's scope (owner,
                  // 2026-07-15) — the orchestrator owns re-render/version-bump policy.
      sourceType: "generated",
      sourceId: null,
      provenance: assetProvenance,
      storageBucket: uploaded.bucket,
      storagePath: uploaded.path,
      checksum: checksumSha256,
      bytes: uploaded.bytes,
      mime: "video/mp4",
      costUsd: metrics.estimatedCostUsd,
      costProvider: RENDER_PROVIDER,
      createdBy: input.ownerId,
      lifecycle: "ready_for_review",
    });
  } catch (err) {
    // Orphan handling (requirement 7): upload succeeded, Asset creation failed —
    // remove the uploaded object, then rethrow the ORIGINAL (more useful) error.
    // Guarded like the read-verify branch above: a failing remove() must never mask
    // `err` — it's just logged, not thrown or swallowed silently.
    await deps.storage.remove(uploaded.bucket, uploaded.path).catch((removeErr: unknown) => {
      console.error("produceVideoAsset: orphan cleanup failed after createAsset error", removeErr);
    });
    throw new AssetPersistFailedError(err instanceof Error ? err.message : String(err), err);
  }

  return { outputAsset, technicalQa, metrics, provenance };
}

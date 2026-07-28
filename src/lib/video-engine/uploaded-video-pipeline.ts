// F3-A — the uploaded_video pipeline branch, EXTRACTED from worker-deps.ts (structural
// refactor; identical behavior). This module OWNS: source resolution, the preparation
// sandbox, executeVideoPreparation, the ephemeral host materialization, the render call
// (produceVideoAsset with the SAME "ListingVideo" composition), provenance, and cleanup.
// worker-deps.ts is now just `switch(strategy) → delegate`.
//
// Deps arrive as a MINIMAL interface (UploadedVideoPipelineDeps) that worker-deps'
// ResolvedWorkerDeps structurally satisfies — this module imports NOTHING from worker-deps,
// so there is no cycle. Boundary: pure video-engine + execution layer + produce-asset;
// no @/lib/creative-jobs, no Supabase, no routes.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Asset, AssetStore } from "@/lib/assets/types";
import type { PipelineProduceInput, ProduceHooks } from "@/lib/video-engine/pipeline";
import { produceVideoAsset, VideoSourceMissingError, type ProduceVideoAssetDeps, type RenderResult } from "@/lib/video-engine/produce-asset";
import type { RenderProvider } from "@/lib/video-engine/render-provider";
import type { StoragePort } from "@/lib/video-engine/storage-port";
import { getRenderProfile } from "@/lib/video-engine/render-profiles";
import { VIDEO_SOURCE_LIMITS } from "@/lib/video-engine/video-source-limits";
import {
  planVideoPreparation,
  PREPARATION_PLAN_SCHEMA_VERSION,
  SOURCE_PLACEHOLDER,
  OUTPUT_PLACEHOLDER,
} from "@/lib/video-engine/prepare-video";
import {
  executeVideoPreparation,
  parseFfprobeToPreparedProbe,
  sha256Hex,
  type VideoPreparationSandbox,
} from "@/lib/video-engine/execute-video-preparation";
import { BASE_ARTIFACT_VERSION } from "@/lib/video-engine/versions";
import { DEFAULT_OPENING_SECONDS, DEFAULT_CLOSING_SECONDS } from "@/remotion/layout";

// The small slice of the resolved worker deps this branch needs. worker-deps'
// ResolvedWorkerDeps is a structural superset, so it passes as-is.
export interface UploadedVideoPipelineDeps {
  assets: AssetStore;
  storage: StoragePort;
  render: RenderProvider;
  runQa: ProduceVideoAssetDeps["runQa"];
  now: () => number;
  brandName: string;
  ctaText: string;
  resolveVideoSource?: (listingId: string, ownerId: string) => Promise<Asset | null>;
  createPrepSandbox?: () => Promise<VideoPreparationSandbox>;
  downloadSourceBytes?: (asset: Asset) => Promise<Buffer>;
  prepTimeoutMs?: number;
  snapshotId?: string;
}

export interface UploadedVideoListing {
  addressLine: string;
  priceLabel: string;
}

// The ONE new pipeline branch. Prepares the clip in its own (ephemeral) sandbox via the
// already-approved executeVideoPreparation, materializes the prepared file as an ephemeral
// HOST temp (never Storage), then calls the SINGLE produceVideoAsset with the SAME
// "ListingVideo" composition + the uploaded_video inputProps. The prepared clip is
// regenerated from the durable source on every attempt and is cleaned on success AND every
// failure (double finally). No worker state / no new state — preparation happens inside the
// existing `running` state, before onStage.
export async function produceUploadedVideoStrategy(
  input: PipelineProduceInput,
  hooks: ProduceHooks,
  deps: UploadedVideoPipelineDeps,
  listing: UploadedVideoListing,
): Promise<RenderResult> {
  const resolveVideoSource = deps.resolveVideoSource;
  const createPrepSandbox = deps.createPrepSandbox;
  const downloadSourceBytes = deps.downloadSourceBytes;
  if (!resolveVideoSource || !createPrepSandbox || !downloadSourceBytes) {
    throw new Error("uploaded-video-pipeline: uploaded_video strategy is missing its wiring deps");
  }
  const prepTimeoutMs = deps.prepTimeoutMs ?? 8 * 60 * 1000;

  const source = await resolveVideoSource(input.listingId, input.ownerId);
  if (!source) {
    // #112 — typed INPUT condition (VIDEO_SOURCE_MISSING, non_retriable).
    throw new VideoSourceMissingError(`uploaded-video-pipeline: no uploaded source video for listing ${input.listingId}`);
  }
  hooks.evidence?.record({ sourceAssetId: source.id });

  const profile = getRenderProfile("standard");
  let hostTempDir: string | null = null;
  try {
    // ---- preparation (own sandbox; prepared file lives ONLY here + a host temp) ----
    // #112 — announce the observability-only 'preparing' stage BEFORE any prep work, so
    // a failure anywhere in this block carries the true stage (not 'download').
    await hooks.onStage("preparing");
    hooks.evidence?.record({ preparation: { snapshotId: deps.snapshotId } });
    const prep = await createPrepSandbox();
    hooks.evidence?.record({ preparation: { sandboxId: (prep as { name?: string }).name } });
    const workspaceDir = `video-jobs/${input.jobId}`;
    const sourcePath = `${workspaceDir}/source.mp4`;
    const outputPath = `${workspaceDir}/prepared.mp4`;

    let preparedDurationSeconds = 0;
    let preparedHasAudio = false;
    let preparationFingerprint = "";
    let ffmpegVersion = "";
    let sourceHash = "";
    let preparationMs = 0;
    try {
      const bytes = await downloadSourceBytes(source);
      await prep.runCommand("sh", ["-c", `mkdir -p ${workspaceDir}`], { timeoutMs: 30000 });
      await prep.writeFiles?.([{ path: sourcePath, content: bytes }]);

      const probe = await prep.runCommand(
        "ffprobe",
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", sourcePath],
        { timeoutMs: 60000 },
      );
      if (probe.exitCode !== 0) {
        // #112 — carry the probe's stderr TAIL (the fatal line, e.g. "moov atom not
        // found") so the evidence pack and error_message tell the operator WHY.
        const probeStderr = await probe.stderr().catch(() => "");
        throw new Error(
          `uploaded-video-pipeline: source ffprobe failed (exit ${probe.exitCode}): ${probeStderr.slice(-1500)}`,
        );
      }
      const sourceMetadata = parseFfprobeToPreparedProbe(await probe.stdout(), bytes.length);
      sourceHash = sha256Hex(bytes);

      // Pure plan (throws a typed VideoPreparationError if the source is out of limits).
      const plan = planVideoPreparation(sourceMetadata, profile, VIDEO_SOURCE_LIMITS, {
        sourceRef: SOURCE_PLACEHOLDER,
        normalizedRef: OUTPUT_PLACEHOLDER,
      });

      hooks.evidence?.record({ preparation: { executed: true } }); // ffmpeg is about to run
      const exec = await executeVideoPreparation({
        sandbox: prep,
        plan,
        profile,
        sourcePath,
        outputPath,
        expectedAudio: sourceMetadata.audioCodec !== null,
        sourceMetadata,
        sourceSha256: sourceHash,
        baseArtifactVersion: BASE_ARTIFACT_VERSION,
        timeoutMs: prepTimeoutMs,
        snapshotId: deps.snapshotId,
        now: deps.now,
      });
      preparedDurationSeconds = exec.preparedSource.durationSeconds;
      preparedHasAudio = exec.preparedSource.hasAudio;
      preparationFingerprint = exec.preparedSource.preparationFingerprint;
      ffmpegVersion = exec.preparedSource.ffmpegVersion;
      preparationMs = exec.provenance.durationMs;
      hooks.evidence?.record({ preparation: { fingerprint: preparationFingerprint, durationMs: preparationMs } });

      const preparedBuf = await prep.readFileToBuffer({ path: outputPath });
      if (!preparedBuf?.length) {
        throw new Error("uploaded-video-pipeline: prepared output was not retrievable from the sandbox");
      }
      hostTempDir = await mkdtemp(path.join(tmpdir(), "video-prepared-"));
      await writeFile(path.join(hostTempDir, "prepared-0.mp4"), preparedBuf);
    } finally {
      // Prepared clip + its whole workspace die with the prep sandbox (nothing persisted).
      await prep.runCommand("rm", ["-rf", workspaceDir], { timeoutMs: 30000 }).catch(() => {});
      await prep.stop().catch(() => {});
    }

    // ---- render the SAME composition with the prepared clip (prep sandbox released) ----
    const hostPreparedPath = path.join(hostTempDir, "prepared-0.mp4");
    const inputProps = {
      source: "uploaded_video" as const,
      property: { addressLine: listing.addressLine },
      priceLabel: listing.priceLabel,
      videoSrc: hostPreparedPath, // render-provider stages this + rewrites → "asset-0.mp4"
      durationSeconds: preparedDurationSeconds,
      hasAudio: preparedHasAudio,
      brand: { name: deps.brandName },
      cta: { text: deps.ctaText },
      badge: null,
    };
    const totalOutputSeconds = DEFAULT_OPENING_SECONDS + preparedDurationSeconds + DEFAULT_CLOSING_SECONDS;
    const expectedSpec = profile.expectedQaSpec(inputProps, totalOutputSeconds);

    return await produceVideoAsset(
      {
        listingId: input.listingId,
        ownerId: input.ownerId,
        sourceAssets: [source],
        inputProps,
        traceId: input.traceId,
        sourceStrategy: "uploaded_video",
        renderProfile: "standard",
        expectedSpec,
        preparation: {
          preparationFingerprint,
          sourceHash,
          ffmpegVersion,
          preparationMs,
          preparationSchemaVersion: PREPARATION_PLAN_SCHEMA_VERSION,
        },
      },
      {
        render: deps.render,
        runQa: deps.runQa,
        storage: deps.storage,
        assets: deps.assets,
        // The prepared HOST temp file IS the single "source" the render stages — no re-download.
        downloadAssets: async () => [hostPreparedPath],
        now: deps.now,
        onStage: hooks.onStage,
        evidence: hooks.evidence,
      },
    );
  } finally {
    // Ephemeral host temp: cleaned on success AND every failure. Prepared clip never persists.
    if (hostTempDir) await rm(hostTempDir, { recursive: true, force: true }).catch(() => {});
  }
}

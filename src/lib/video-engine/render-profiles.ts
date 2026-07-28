// F3-A Step 1 — the Render Profile contract + registry (Seam D of the two-axis design). A
// render profile answers "what output shape/objective?" (dimensions, fps, codecs, expected
// QA) — INDEPENDENT of the Source Strategy ("where does content come from?"). The registry
// ships exactly one profile (`standard`) and is open for additive entries; adding a profile
// never requires touching any source strategy, and vice versa (proved by
// strategy-profile-independence.test.ts).
//
// CONTRACT ONLY: no rendering, no I/O. Not imported by the production path yet → zero
// behavior change.
import type { CompositionInput } from "@/lib/video-engine/composition-input";
import type { ExpectedVideoQaSpec } from "@/lib/video-engine/qa-contract";
import { FINAL_OUTPUT_COLOR_CONTRACT } from "@/lib/video-engine/qa";
import { VIDEO_OUTPUT_SPEC } from "@/lib/video-engine/video-source-limits";

export const RENDER_PROFILES = ["standard"] as const;
export type RenderProfile = (typeof RENDER_PROFILES)[number];

export interface RenderProfileSpec {
  id: RenderProfile;
  width: number;
  height: number;
  fps: number;
  videoCodec: "h264";
  audioCodec: "aac";
  // The shared composition id every profile drives (there is never a per-profile or
  // per-strategy composition — ADR-0001).
  compositionId: "ListingVideo";
  // Duration tolerance (seconds) for the output QA duration check.
  durationToleranceSec: number;
  // PURE derivation of the expected technical QA spec for a produced output.
  //  - dimensions/fps/codecs come from the PROFILE (static);
  //  - `totalOutputDurationSeconds` is supplied by the caller from the composition's own
  //    calculateMetadata (the single source of truth for duration — NOT recomputed here,
  //    so this stays decoupled from Remotion timing internals);
  //  - `audioExpected` comes from the CompositionInput's PUBLIC fields (a video's hasAudio;
  //    a photo slideshow never has audio) — the profile does NOT branch on which SOURCE
  //    STRATEGY produced the input, only on the input's shape. That is the independence.
  expectedQaSpec(input: CompositionInput, totalOutputDurationSeconds: number): ExpectedVideoQaSpec;
}

const STANDARD: RenderProfileSpec = {
  id: "standard",
  width: VIDEO_OUTPUT_SPEC.width,
  height: VIDEO_OUTPUT_SPEC.height,
  fps: VIDEO_OUTPUT_SPEC.fps,
  videoCodec: VIDEO_OUTPUT_SPEC.videoCodec,
  audioCodec: VIDEO_OUTPUT_SPEC.audioCodec,
  compositionId: "ListingVideo",
  durationToleranceSec: 2,
  expectedQaSpec(input, totalOutputDurationSeconds) {
    const audioExpected = input.source === "uploaded_video" ? input.hasAudio : false;
    return {
      container: "mp4",
      codec: VIDEO_OUTPUT_SPEC.videoCodec,
      width: VIDEO_OUTPUT_SPEC.width,
      height: VIDEO_OUTPUT_SPEC.height,
      fps: VIDEO_OUTPUT_SPEC.fps,
      durationSec: totalOutputDurationSeconds,
      toleranceSec: this.durationToleranceSec,
      color: FINAL_OUTPUT_COLOR_CONTRACT,
      audioExpected,
      ...(audioExpected ? { audioCodec: VIDEO_OUTPUT_SPEC.audioCodec } : {}),
      aspect: { width: 16, height: 9 },
      audioVideoDurationToleranceSec: 0.5,
    };
  },
};

export const RENDER_PROFILE_REGISTRY: Record<RenderProfile, RenderProfileSpec> = {
  standard: STANDARD,
};

export function getRenderProfile(id: RenderProfile): RenderProfileSpec {
  return RENDER_PROFILE_REGISTRY[id];
}

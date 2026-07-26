// F3-A Step 1 — the uploaded_video job lifecycle as a PURE state-machine contract. This is
// the TARGET machine (adds `validating` + `preparing` to the technical lifecycle); it does
// NOT modify the production Creative Job machine (src/lib/creative-jobs/states.ts) and is
// not wired into the worker/DB in this step. A later, separately-authorized step reconciles
// these two states + edges into the shared machine (keeping `running → rendering` legal so
// photo_slideshow is unchanged). Pure — no I/O, no Date.now(). Zero behavior change.
//
// An illegal transition is the contract violation reported as VIDEO_STATE_TRANSITION_INVALID
// (src/lib/video-engine/video-errors.ts).
import type { VideoErrorCode } from "@/lib/video-engine/video-errors";

export const VIDEO_JOB_STATES = [
  "queued",
  "running",
  "validating", // NEW (F3-A): authorize source + technically validate (ffprobe) it
  "preparing", // NEW (F3-A): FFmpeg-normalize the source to the output frame
  "rendering",
  "qa",
  "uploading",
  "completed",
  "failed",
  "cancelled",
] as const;
export type VideoJobState = (typeof VIDEO_JOB_STATES)[number];

// Terminal states have an empty edge set — enforced structurally, not by special-casing.
// `qa` and `uploading` have NO `-> cancelled` edge: a near-done render/upload is finished
// rather than half-cancelled (mirrors the existing machine's rule).
export const VIDEO_JOB_LEGAL_TRANSITIONS: Record<VideoJobState, VideoJobState[]> = {
  queued: ["running", "cancelled"],
  running: ["validating", "failed", "cancelled"],
  validating: ["preparing", "failed", "cancelled"],
  preparing: ["rendering", "failed", "cancelled"],
  rendering: ["qa", "failed", "cancelled"],
  qa: ["uploading", "failed"],
  uploading: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_VIDEO_JOB_STATES: readonly VideoJobState[] = ["completed", "failed", "cancelled"];

export function isTerminalVideoJobState(state: VideoJobState): boolean {
  return VIDEO_JOB_LEGAL_TRANSITIONS[state].length === 0;
}

export function canVideoTransition(from: VideoJobState, to: VideoJobState): boolean {
  return VIDEO_JOB_LEGAL_TRANSITIONS[from].includes(to);
}

// Carries the stable error code so a caller that guards a transition can surface exactly
// VIDEO_STATE_TRANSITION_INVALID. Pure (throws on invalid INPUT; no side effects).
export class VideoStateTransitionError extends Error {
  readonly code: VideoErrorCode = "VIDEO_STATE_TRANSITION_INVALID";
  constructor(
    readonly from: VideoJobState,
    readonly to: VideoJobState,
  ) {
    super(`illegal uploaded_video job transition: ${from} -> ${to}`);
    this.name = "VideoStateTransitionError";
  }
}

export function assertVideoTransition(from: VideoJobState, to: VideoJobState): void {
  if (!canVideoTransition(from, to)) {
    throw new VideoStateTransitionError(from, to);
  }
}

// The happy-path spine (excludes failed/cancelled edges) — used by tests + docs to assert
// the intended forward order without hardcoding it in two places.
export const VIDEO_JOB_HAPPY_PATH: readonly VideoJobState[] = [
  "queued",
  "running",
  "validating",
  "preparing",
  "rendering",
  "qa",
  "uploading",
  "completed",
];

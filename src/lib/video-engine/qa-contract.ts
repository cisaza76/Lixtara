// F3-A Step 1 — the audio-aware QA spec contract. EXTENDS the existing pure
// ExpectedTechnicalSpec (src/lib/video-engine/qa.ts) with the fields an uploaded_video
// output needs QA to check, WITHOUT modifying qa.ts (whose `parseFfprobe` behavior is
// untouched in this step — it simply ignores fields it doesn't read). Type-only import →
// zero runtime coupling, zero behavior change. The actual audio/aspect/coherence checks
// in parseFfprobe are a later, separately-authorized step.
import type { ExpectedTechnicalSpec } from "@/lib/video-engine/qa";

export interface ExpectedVideoQaSpec extends ExpectedTechnicalSpec {
  // Whether the OUTPUT must carry an audio stream. photo_slideshow → false (no regression:
  // photo renders have no audio and QA won't look for one). uploaded_video → mirrors the
  // source's `hasAudio`.
  audioExpected: boolean;
  // Required audio codec WHEN audioExpected is true.
  audioCodec?: "aac";
  // Expected display aspect ratio of the output (16:9 for the standard profile).
  aspect?: { width: number; height: number };
  // Allowed drift between the audio and video stream durations before QA fails (only
  // meaningful when audioExpected is true).
  audioVideoDurationToleranceSec?: number;
}

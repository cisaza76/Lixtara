// Layout + timing constants for the `ListingVideo` composition. Pure data — no
// React, no Remotion runtime imports — so it can be unit-tested and reused by
// future formats (P2 Task 5+) without pulling in JSX.

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const FPS = 30;

// Default per-section timing (seconds). `totalDurationFrames` accepts overrides
// so callers/tests can compute other combinations without touching this module.
export const DEFAULT_OPENING_SECONDS = 2.5;
export const DEFAULT_PHOTO_SECONDS = 4;
export const DEFAULT_CLOSING_SECONDS = 3;

// Crossfade overlap between consecutive photo sequences, in frames. Kept short
// relative to a photo's on-screen time so the effect reads as a soft dissolve,
// not a competing motion.
export const CROSSFADE_FRAMES = 20;

// The badge-reserved rect ("New" / "Price Reduced" / "Open House", …). Anchored
// top-right with generous margins so text of a few different lengths fits
// without redesign. The photo layer and lower-third copy must never render
// inside this rect, badge present or not, so future badges are a pure additive
// change to the layout, not a rework.
export const SAFE_AREA = {
  top: 64,
  right: 64,
  width: 480,
  height: 120,
} as const;

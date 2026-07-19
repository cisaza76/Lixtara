// Pinned, versioned constants for the Video Engine's render pipeline. These are the
// backbone of `RenderProvenance` (see render-provider.ts) — every video Asset must be
// able to answer "which template, which bundle, which renderer, which execution
// provider produced this?" months later. Bump the relevant constant (never mutate a
// shipped meaning in place) whenever the underlying thing actually changes.

// The Remotion composition this engine renders (src/remotion/ListingVideo.tsx).
export const TEMPLATE_ID = "ListingVideo";

// Bump when the composition's VISUAL output changes in a way that matters for audit
// (layout, timing, brand). Independent of the input schema below — a template can
// change its rendering of the same inputProps shape.
export const TEMPLATE_VERSION = "1";

// Bump when `listingVideoInputSchema` (src/remotion/input.ts) changes shape.
export const INPUT_SCHEMA_VERSION = "1";

// Exact pinned version of remotion / @remotion/bundler / @remotion/renderer (see
// package.json — all three are pinned in lockstep, no caret).
export const RENDERER_VERSION = "4.0.489";

// Execution provider — WHERE the render ran, distinct from `provider` on the video
// Asset's AssetProvenance (WHAT produced the pixels, e.g. "remotion"). Kept as its own
// constant so a future escape hatch (e.g. a Lambda renderer) is a one-line swap here,
// not a hunt through the codebase (see the task brief's "Rollback" note).
export const RENDER_PROVIDER = "vercel-sandbox";

// Version tag of the prebuilt Vercel Sandbox base artifact (Node 24, Chromium + its OS
// libs, ffmpeg/ffprobe, xz, the pinned Remotion packages baked in). BAKED + validated
// 2026-07-19 as the permanent, non-expiring snapshot `snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC`
// (region iad1) — a **Production Candidate**; all 10 recipe gates passed. See
// docs/superpowers/runbooks/2026-07-18-creative-studio-sandbox-artifact.md.
// `SandboxRemotionProvider` reads this constant (or an injected override) as its default
// base reference and stamps it onto every rendered video's provenance. NOTE: this tag is
// NOT an activation switch — the snapshotId itself lives ONLY in the
// CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID env var (still unset), so the provider still fails
// loudly at render time until that env var is set. Bump this tag together with a new
// snapshotId whenever a new artifact is baked (keep the pair for rollback).
export const BASE_ARTIFACT_VERSION = "base-2026-07-19-ffmpeg8.1.2-remotion4.0.489";

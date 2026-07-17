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

// Version tag of the prebuilt Vercel Sandbox base artifact (Node 24, Chromium + its
// OS libs, ffmpeg/ffprobe, xz, the pinned Remotion packages baked in — see
// docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md §3/§7). NOT YET BUILT as
// of this module's authoring — Task 5 (Gate B2) only proves the render+QA+persistence
// logic against `FakeRenderProvider`; baking and versioning the actual snapshot/VCR
// image is separate follow-up work. `SandboxRemotionProvider` reads this constant (or
// an injected override) as its default base reference; until a real artifact exists,
// constructing it without an explicit `baseArtifact` override will fail loudly at
// render time rather than silently hitting a stock (un-prepared, npm-install-required)
// runtime. Update this string the moment a real base artifact is baked and versioned.
export const BASE_ARTIFACT_VERSION = "unbaked-pending-prebuilt-base";

# ADR-0012 — Final Remotion output color contract (yuv420p / tv / bt709)

- **Status:** accepted (2026-07-27) — implementation merged per Issue #111; Preview
  validation renders (photos + uploaded_video) are a pre-close condition tracked on the PR
- **Context:** Issue #111 (Gate 5A residual finding, 2026-07-27)
- **Related:** ADR-0011 (color-range normalization in the preparation stage), ADR-0005
  (single-sandbox pipeline)

## Context

PR #110 / ADR-0011 fixed the **preparation** stage: prepared intermediates are verified
`yuv420p` + `color_range ∈ {tv, null}` with real value conversion. But the **final
Remotion render** still probed as `yuvj420p / color_range=pc` (full range) — pre-existing
encoder behavior, independent of the source's range: `renderMedia` was called without a
`colorSpace` option, so Remotion passed no color flags to ffmpeg and x264 emitted
full-range output from the RGB frames.

Tested players honor the VUI full-range flag, so playback was correct in Gates 3/4. The
risk is downstream: hardware decoders, editing tools, and platform re-encodes that ignore
VUI tags assume limited range — full-range content misplays there as contrast distortion
(a user-visible defect once real sellers watch their videos). Accepted at Gate 5A closeout
as a residual finding; resolved before Gate 5C per the approved Gate Review.

## Decision

1. **Contract:** every final Creative Studio output must probe as H.264 `yuv420p`,
   `color_range=tv`, `color_space=bt709`, `color_primaries=bt709`, `color_transfer=bt709`.
   Consistent with the prepared-intermediate contract (ADR-0011) and with Remotion's own
   recommendation (`bt709` becomes the default in Remotion 5.0).
2. **Mechanism:** the in-sandbox render script pins `renderMedia({ colorSpace: "bt709" })`.
   In `@remotion/renderer` 4.0.489 this passes ffmpeg `-colorspace/-color_primaries/
   -color_trc bt709`, `-color_range tv`, **and** a `zscale=…:range=limited` filter — real
   value conversion, not retagging (ADR-0011's measured rejection of retag-only stands).
3. **Fail-closed QA:** `parseFfprobe` (the in-sandbox technical QA that runs before any
   Asset row exists) now asserts all five fields strictly against
   `ExpectedTechnicalSpec.color` (`FINAL_OUTPUT_COLOR_CONTRACT`). A stream missing any
   field fails its check. Both spec constructors (photo-slideshow `expectedSpecFor`, the
   `standard` render profile) declare the contract; a regression in Remotion's encode
   behavior therefore fails the render instead of shipping a non-conforming video.

## Measured evidence (2026-07-27, Darwin arm64, @remotion/renderer 4.0.489)

Controlled composition with exact RGB patches — white (255,255,255), black (0,0,0),
gray (128,128,128), red (255,0,0) — rendered twice with the production call shape
(`codec: "h264"`, default options), without and with `colorSpace: "bt709"`:

| | pre-fix (no colorSpace) | post-fix (`bt709`) |
|---|---|---|
| ffprobe | `yuvj420p / pc / bt470bg` | `yuv420p / tv / bt709×3` ✔ |
| coded Y, white | 255 | **235** |
| coded Y, black | 0 | **16** |
| coded Y, gray | 128 | **126** (= 16 + 219·128/255) |

Coded values measured with `signalstats` (reads actual samples, blind to tags): the
post-fix output carries genuinely limited-range values — **the difference is in the
pixel data, not the VUI metadata**. This also proves the render did NOT take Remotion's
`hasPreencoded` branch (which skips the zscale filter and would have left 255/0 under a
`tv` tag — the retag failure mode this contract forbids).

**Known nuance (accepted):** Remotion's conversion compresses range per-plane over the
601-matrix YUV the encode pipeline produces, then tags the stream bt709. Neutral tones
decode identically everywhere (white/black/gray byte-exact in an A/B decode). Fully
saturated primaries shift slightly in tag-honoring players (pure red decodes
≈ (255,24,0) instead of (255,0,0)). This is upstream Remotion behavior — identical for
every render, the same thing Remotion 5.0 will do by default — and immaterial for listing
content (photography + brand ivory/gold, no saturated primaries); the Preview visual
review validates this on real compositions.

## Consequences

- **Historical assets stay as rendered.** No re-render, no lifecycle change; anything
  produced before the deploy is documented as pre-contract (`yuvj420p/pc`, identifiable
  by probe). The contract applies prospectively.
- Players that ignore VUI range tags now show correct contrast — the motivating risk case.
- Any future Remotion upgrade that changes encode color behavior is caught in-sandbox by
  QA (fail-closed) instead of surfacing as user-visible washed-out video.

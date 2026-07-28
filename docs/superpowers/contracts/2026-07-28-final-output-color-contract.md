# Contract note — Creative Studio final output color (effective PR #113)

**As of PR #113 (merged 2026-07-28), the official contract for every final Creative
Studio video output is: H.264 + `yuv420p` + `color_range=tv` + bt709
(`color_space` / `color_primaries` / `color_transfer`). Any different output
constitutes a QA failure.**

- Enforced fail-closed by the in-sandbox technical QA (`parseFfprobe`,
  `src/lib/video-engine/qa.ts` — `FINAL_OUTPUT_COLOR_CONTRACT`): a stream missing any
  color field fails its check before an Asset row is ever created.
- Produced by `renderMedia({ colorSpace: "bt709" })` in the render script
  (`src/lib/video-engine/render-provider.ts`) — real pixel-value conversion, not VUI
  retagging (measured; see ADR-0012).
- Applies prospectively to both strategies (`photo_slideshow` and `uploaded_video`).
  Assets rendered before the PR #113 deploy remain as rendered (pre-contract,
  identifiable by probe: `yuvj420p/pc`).
- Full rationale, measured evidence, and the accepted saturated-primaries upstream
  nuance: `docs/adr/0012-final-output-color-contract.md` · Issue #111 (closure comment
  links the frozen Preview validation evidence).

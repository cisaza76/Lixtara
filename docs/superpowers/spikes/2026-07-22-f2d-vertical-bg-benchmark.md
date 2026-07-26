# F2-D — 9:16 background-fill strategy benchmark

- **Type:** Controlled benchmark (throwaway). NOT feature implementation.
- **Branch:** `spike/f2d-vertical-bg` (0 commits over `main`; discardable).
- **Date:** 2026-07-22
- **Goal:** resolve the vertical-render cost surfaced in F2-C (dual-decoder blurred-fill ≈ 14×
  realtime) by comparing background strategies on quality vs performance, and recommend one.
- **Recommendation:** ✅ **Strategy C — ffmpeg pre-baked blurred-fill normalization.** Best visual
  quality (verified), single-decoder performance (~2× realtime, ~5× cheaper than the F2-C dual path),
  and — decisively — a **deterministic layout that does not depend on `@remotion/media`'s `objectFit`
  semantics**. Recommended fallback: **Strategy A (solid brand)** for a cheaper editorial look.

---

## Setup

One synthetic **15 s, 1080×1920 (9:16), 30 fps, h264/AAC** clip (`mandelbrot` source — photo-like
detail so blur is judgeable — + `sine` audio). Rendered through an experimental composition
(OpeningCard → body → ClosingCard) to **1920×1080 / 30 fps / h264 / AAC**, on the current snapshot
`snap_pabjEZEF…` (Amazon Linux 2023 / glibc 2.34), `@remotion/media@4.0.489` in-sandbox (`--no-save`),
4 vCPU. Output duration 17 s (15 s body + 2×1 s cards). One mid-body frame captured per strategy.

Strategies:
- **A — solid brand background.** Dark `#0F172A` fill + one `<Video objectFit="contain">`. 1 decoder.
- **B — static blurred poster.** One frame (mid-clip) blurred with ffmpeg `gblur` → `<Img cover>`
  background + `<Video contain>`. 1 decoder + 1 still.
- **C — ffmpeg pre-baked blurred-fill.** One ffmpeg pass converts 9:16 → 16:9 with a moving blurred
  cover background + centered contained foreground baked into the pixels; Remotion then plays that
  standard 16:9 clip with **one** `<Video objectFit="cover">`. 1 decoder + 1 ffmpeg prepass.
- **D — dual live `<Video>` (F2-C reference).** Two decoders: blurred cover background + contained
  foreground, blur via CSS `filter`.

## Results

| Strategy | prepass | render | total | RTF (total/17 s) | peak mem | out size | visual |
|---|---|---|---|---|---|---|---|
| A solid | 0 | 37.3 s\* | 37.3 s | 2.2× | 3.40 GB | 40.9 MB | full-frame (see note) |
| B poster | 0.6 s | 26.5 s | 27.1 s | 1.6× | 3.37 GB | 0.87 MB | harness mis-layered |
| **C prebaked** | **6.3 s** | **30.0 s** | **36.3 s** | **2.1×** | **3.30 GB** | 17.0 MB | ✅ **perfect** |
| D dual | 0 | 158.3 s | 158.3 s | 9.3× | 3.24 GB | 37.9 MB | same look as C |

\* Strategy A ran first and paid cold-start (bundler/Chromium warmup); warm single-decoder render is
~26–30 s. All outputs `DECODE_CLEAN`, both streams present, no `libc`/`fallback`/`EACCES`.

**Performance:** the three single-decoder strategies (A/B/C) all render at ~**1.6–2.2× realtime**; the
**dual path (D) is ~9× realtime here — ~5× the single-decoder cost** (consistent with F2-C's 14× at
30 s; the multiplier grows with duration/resolution). Extrapolated to **90 s vertical**: C ≈ ~3.7 min
total vs D ≈ ~23 min. Memory at 15 s sat ~3.3 GB for all (it climbed to ~5.6 GB at 30 s/90 s in F2-C —
memory scales with duration, reinforcing a duration cap).

**Visual quality (frames inspected):**
- **C** produced exactly the intended premium look: a sharp centered 9:16 portrait with a real,
  motion-matched blurred background and no clipping. Because the layout is composited by ffmpeg, the
  result is **deterministic and independent of `@remotion/media` `objectFit` behavior**.
- **D** looked equivalent to C (this also *corrects* an F2-C note: CSS blur *does* apply on
  `@remotion/media <Video>`; F2-C's hard-edged `testsrc2` bars merely hid it) — but at 5× the cost.
- **A** rendered sharp content edge-to-edge rather than a clean letterbox: `@remotion/media`
  `objectFit="contain"` did **not** reliably letterbox in this harness — an ambiguity that makes the
  pure-Remotion strategies (A/D) fragile and that C avoids entirely.
- **B** rendered fully blurred with the foreground video not visible — a **layering bug in the quick
  harness** (not pursued: C dominates it — motion background beats a frozen one at similar cost).

## Recommendation

**Adopt Strategy C — normalize any uploaded clip to the target 16:9 via a single ffmpeg pre-pass
(blurred-fill for portrait/odd aspect ratios), then render one standard 16:9 `<Video>` in Remotion.**

Why C wins:
1. **Quality:** the only strategy whose premium blurred-fill look was verified correct on-frame.
2. **Performance:** single-decoder (~2× realtime), ~5× cheaper than the F2-C dual path; makes 90 s
   vertical viable (~3.7 min vs ~23 min).
3. **Determinism/robustness:** layout is baked by ffmpeg, so it does **not** depend on
   `@remotion/media` `objectFit` semantics (which proved unreliable for `contain` here). Fewer moving
   parts in the render.
4. **Architectural fit:** the same normalization pre-pass naturally also handles rotation metadata,
   odd/off dimensions, and any source aspect ratio — a general "normalize source → 16:9" seam for the
   `uploaded_video` strategy, upstream of the shared Remotion composition.

**Fallback:** Strategy A (solid brand background) for a cheaper, cleaner editorial framing if a fill
is not wanted — but it needs a reliable letterbox (pad the video in the ffmpeg pre-pass rather than
rely on Remotion `objectFit`). Given C is only ~1.2× the cost of A and looks markedly more premium, C
is the default; A is an option, not the baseline.

**Reference ffmpeg pre-pass (portrait → 16:9 blurred fill), for the implementation gate:**
```
ffmpeg -i in.mp4 -filter_complex \
 "[0:v]split=2[bg][fg];\
  [bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=30[bgb];\
  [fg]scale=-2:1080[fgs];\
  [bgb][fgs]overlay=(W-w)/2:0[v]" \
 -map "[v]" -map 0:a -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a copy out16x9.mp4
```
(`gblur` sigma, brand tint/darken overlay, and a duration cap are implementation tuning, not part of
this decision.)

## Decision → next step

Vertical cost is resolved: **C** keeps 9:16 (and any aspect) affordable and premium on the current
runtime with no re-bake. This unblocks the **`uploaded_video` MVP implementation** — where the ffmpeg
normalization pre-pass becomes the source strategy's "prepare" step ahead of the shared
`ListingVideoComposition`.

## Safety / hygiene

No Production/Preview, env, migration, bucket, RLS, upload, route, UI, cron, secret, PR, merge,
deploy, or re-bake. `@remotion/media` in-sandbox only (`--no-save`) — `package.json`/lockfile
unchanged. Synthetic in-sandbox media only, destroyed with the sandbox. Driver transient (removed).
Branch `spike/f2d-vertical-bg`: 0 commits over main; safe to delete.

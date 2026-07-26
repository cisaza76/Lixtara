# F2-C — `@remotion/media` `<Video>` Compatibility Micro-Spike

- **Type:** Controlled technical spike (throwaway). NOT feature implementation.
- **Branch:** `spike/f2c-media-video` (0 commits over `main`; discardable).
- **Date:** 2026-07-22
- **Verdict:** ✅ **Go** — `@remotion/media` `<Video disallowFallbackToOffthreadVideo>` renders video
  **correctly, stably, and without fallback** on the **current** snapshot (Amazon Linux 2023 /
  **glibc 2.34**), **no re-bake required**. Amazon Linux 2023 stays; F2-B's matrix should resume on
  this route.
- **One-line finding:** where F2-B proved `<OffthreadVideo>` cannot run (needs glibc ≥ 2.35),
  `@remotion/media <Video>` (Mediabunny frame extraction) renders on glibc 2.34 with the native
  compositor **provably never executed** (kept `chmod 000` throughout — renders still succeeded).

---

## 1. Environment under test

| Property | Value | Source |
|---|---|---|
| Base snapshot | `snap_pabjEZEF5zsaYlQmX3tsgpyMmT3m` (`base-2026-07-21-fonts-system-ffmpeg8.1.2-remotion4.0.489`) | code default + API `status=created` |
| OS / **glibc** | Amazon Linux 2023.11 / **glibc 2.34** | `getconf`/`ldd` in-sandbox |
| Node | v24.14.1 | `node -v` |
| Remotion | 4.0.489 | `remotion/package.json` |
| **`@remotion/media`** | **4.0.489** (installed in-sandbox `--no-save`, **not committed**) | `@remotion/media/package.json` |
| Chromium | via `ensureBrowser` (chrome-headless-shell) | driver |
| ffmpeg / ffprobe | 8.1.2 (BtbN GPL, baked) | `ffmpeg -version` |
| Sandbox | 4 vCPU, MemTotal 8.6 GB, cgroup `memory.max=max`, `/tmp` 32 GB (29 GB free), timeout set by driver | `nproc`/`/proc/meminfo`/`df` |
| Snapshots intact | `snap_pabjEZEF…` + `snap_8gmMWE8S…` both `status=created` | API |

**Preflight recorded:** main `0f6c58206b774a5d791619e5b3b956963cd20519`; experimental branch
`spike/f2c-media-video`; `@remotion/media` **absent** from `package.json` and `pnpm-lock.yaml`
(only `@remotion/media-parser` / `@remotion/media-utils`, unrelated) → installed in-sandbox only.

## 2. Exact component tested

```tsx
import { Video } from "@remotion/media";
// body of an experimental composition (OpeningCard → Video → ClosingCard, 1920×1080/30/h264):
<Video src={staticFile(clip)} disallowFallbackToOffthreadVideo objectFit="cover" />
```

NOT `<OffthreadVideo>`, NOT `<Html5Video>`, NOT a raw HTML `<video>`. The production `ListingVideo`
was never imported or touched. `@remotion/media` uses **Mediabunny** for exact frame extraction —
the modern path Remotion recommends over the native compositor.

## 3. Confirmation: fallback to OffthreadVideo disabled

`disallowFallbackToOffthreadVideo: true` was set on **every** `<Video>`. This is code-level proof a
success cannot route through the incompatible compositor. Belt-and-suspenders: see §9.

## 4. Result — 10 s case (Stage 1)

**PASS.** 16:9 30 fps h264/AAC 10 s synthetic fixture (`testsrc2` + `sine`) rendered end-to-end.

- Render exit 0; output h264 + AAC, 1920×1080, 30/1 fps, 12.0 s (10 s body + 2×1 s cards),
  both streams, `start_time=0`, **`DECODE_CLEAN`** (full re-decode, no corruption).
- Frame inspection (0/25/50/75/100 % of body + transition): `testsrc2` decoded at full resolution;
  on-screen clip timer read `00:00:00.067` at body-start and `00:00:05.000` at body-mid →
  **frame-accurate A/V sync**; frames differ across time (real decode + progression, not frozen); the
  closing card ("lixtara.com", Playfair Display system font) renders over ivory. No `Libc 2.35`,
  no fallback, no compositor process.

## 5. Result — 30 s & 90 s (Stage 2)

All **PASS** (h264/AAC, 1920×1080, 30 fps, `DECODE_CLEAN`, no libc/fallback/compositor/EACCES):

- **30 s horizontal** — output 32.0 s / 38.5 MB.
- **30 s vertical 9:16 blurred-fill** — output 32.0 s / 28 MB; normalized to 1920×1080 via
  `objectFit:"contain"` **with no clipping and no error**. Caveat below (§8).
- **90 s horizontal** — output 92.0 s / 115 MB. Confirms a **90 s clip is fully supported** on the
  current runtime.

## 6. Metrics

Real-time factor (RTF) = `render_ms ÷ output_seconds` (higher = slower; >1 means slower than realtime).

| Clip | prep | render | wall | RTF | peak mem | peak `/tmp` | in size | out size | out dur |
|---|---|---|---|---|---|---|---|---|---|
| 10 s H (Stage 1) | — | 26.6 s | 26.6 s | 2.2× | 3.08 GB | 668 MB | 6.8 MB | 12.9 MB | 12 s |
| 30 s H | 6.0 s | 87.1 s | 94 s | 2.7× | 3.05 GB | 717 MB | 20.5 MB | 38.5 MB | 32 s |
| 30 s V blurred (2 decoders) | 5.1 s | **456 s** | 462 s | **14.3×** | **5.62 GB** | 762 MB | 22.2 MB | 28 MB | 32 s |
| 90 s H | 2.2 s | 267 s | 269 s | 2.9× | 5.66 GB | 973 MB | 61.3 MB | 115 MB | 92 s |

**Reading:** single-decoder horizontal is ~**2.2–2.9× realtime** (a 90 s clip ≈ 4.5 min render — fine
for an async worker). Memory peaks ~**5.6 GB** at 90 s and vertical — under the 8.6 GB cap but with
limited headroom, so duration/resolution must stay bounded. The **vertical blurred-fill path is
~14× realtime** because it decodes the source **twice per frame** (blurred cover background +
contained foreground) — a real cost driver (a 90 s vertical would be ~20+ min at this cost).

## 7. Audio & sync

Preserved and synced. Output always carries an AAC stream (48 kHz) with duration matching video
(12/32/32/92 s). Verbose logs show `@remotion/media` extracting the source audio
(`media-video-…​.wav`) and mixing it via ffmpeg. Frame-accurate sync verified visually against the
`testsrc2` on-screen timer (§4). On vertical, `volume:0` on the blurred background layer prevented
double audio.

## 8. Vertical & blurred-fill

- ✅ **Runtime viability:** the 9:16 source normalized to a 1920×1080 output **without error and
  without clipping** (`objectFit:"contain"` → letterboxed centered content). No crash, `DECODE_CLEAN`.
- ⚠️ **Styling caveat (implementation, not runtime):** the intended **blurred fill did not visibly
  render** in this minimal harness — a parent CSS `filter: blur(48px)` on `@remotion/media <Video>`
  did not take visual effect (the background `cover` layer showed sharp, edge-to-edge). This is a
  **v1 styling detail to solve during implementation** (e.g. apply blur via a different mechanism than
  a wrapper CSS filter), **not** a runtime blocker for F2-C's question. Also noted: `@remotion/media`
  emits a cosmetic warning to prefer the `objectFit` prop over `style` — honored.

## 9. Evidence the incompatible compositor was NOT used

Multiple independent proofs, all consistent:

1. **`disallowFallbackToOffthreadVideo: true`** on every `<Video>` — the fallback path is
   code-disabled.
2. **Compositor binary `chmod 000` (execute denied)** before rendering and kept so for the whole run
   (`@remotion/compositor-linux-x64-gnu/remotion`). All four renders still succeeded — a fallback
   would have failed with **EACCES** (or the `Libc 2.35` error); neither ever appeared.
3. **No `Libc 2.35` error** in any render (the exact signature that killed F2-B's OffthreadVideo).
4. **No `compositor` process** observed by the process watcher during render; log scan for
   `libc|fallback|compositor|EACCES` returned empty on all clips.

## 10. Re-bake needed?

**No.** `@remotion/media <Video>` renders on the **current** Amazon Linux 2023 / glibc 2.34 artifact
as-is. This is the material difference from F2-B (`<OffthreadVideo>` required glibc ≥ 2.35 → re-bake).
Adopting this route for production requires only adding `@remotion/media@4.0.489` as a dependency (a
later implementation gate) — **not** a new base OS.

## 11. Verdict

✅ **Go.** `@remotion/media <Video>` is an exact, stable, fallback-free video render path on the
current snapshot with no re-bake. Two engineering notes carried forward (neither blocks Go):
(a) blurred-fill styling needs a proper implementation approach (§8); (b) the dual-decoder vertical
path is expensive (~14× realtime) and argues for a duration cap and/or a cheaper blur strategy (§6).

## 12. Recommended next gate

Per the decision rule (below), **resume the F2-B measurement matrix on the `@remotion/media <Video>`
route, on the current artifact (no re-bake)**: codec/container acceptance matrix (MP4/MOV/HEVC/
unsupported), negative tests with distinguishable error codes, original-audio matrix, and the MVP
duration/format/resolution limits — plus deciding the blurred-fill implementation approach and
whether to cap vertical duration. Only when moving to real implementation: add `@remotion/media`
to `package.json`/lockfile and retrofit under the F2-A generic pipeline. **Not authorized by F2-C.**

## Decision rule (from the gate) — outcome

- ✅ *"Si `@remotion/media <Video>` funciona de forma exacta, estable y sin fallback, se mantiene
  Amazon Linux 2023 y se continúa midiendo la matriz de F2-B sobre esta ruta."* → **This path.**
- ❌ *"Si falla … o cae en `<OffthreadVideo>`, … el siguiente gate será diseñar el nuevo base
  artifact."* → Not triggered.
- `<Html5Video>` was **not** adopted; the spike was **not** converted into implementation.

## Safety / hygiene

No Production/Preview surface touched; no env var, migration, bucket, RLS, upload, permanent route,
UI, cron, secret, PR, merge, deploy, or re-bake. `@remotion/media` installed **in-sandbox only**
(`--no-save`) — `package.json`/`pnpm-lock.yaml` unchanged. Only synthetic in-sandbox media
(`testsrc2`+`sine`), destroyed with the sandbox. Driver files transient (`*.tmp.mjs`, removed).
Branch `spike/f2c-media-video` has **0 commits over main**; safe to delete.

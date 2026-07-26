# F2-B — OffthreadVideo Compatibility & Performance Spike

- **Type:** Controlled technical spike (throwaway). NOT feature implementation.
- **Branch:** `spike/f2b-offthreadvideo` (0 commits over `main`; discardable).
- **Date:** 2026-07-22
- **Verdict:** ⛔ **No-Go on the current base artifact** → **Conditional-Go pending a base-OS decision.**
- **One-line finding:** `<OffthreadVideo>` **cannot render in the current snapshot without a
  re-bake** — the Remotion native video compositor requires **glibc ≥ 2.35** and the base artifact
  (Amazon Linux 2023) ships **glibc 2.34**. The photo pipeline is unaffected (it never invokes that
  binary), which is why all of F1 renders correctly.

---

## 1. Objective & scope

Answer, with evidence, the 10 F2-B questions — chiefly **Q1: can the current snapshot render
`<OffthreadVideo>` without a re-bake?** Per the gate's closing rule, *"si `<OffthreadVideo>` no
funciona en el snapshot actual, detente y reporta."* That rule fired: the answer to Q1 is **no**, so
the spike stopped at Stage 1 and this is the report. The full fixture matrix, negative tests, and
performance measurements were **not** run — they are moot until a runtime that can execute
OffthreadVideo exists.

**Restrictions honored:** no migrations, buckets, RLS, signed uploads, permanent API routes, UI,
data-model changes, Production changes, Preview changes, `photo_slideshow` changes, `ListingVideo`
refactor, `source_strategy`/`render_profile` implementation, contract freeze, PR, or merge. No
private/client videos (only in-sandbox synthetic `testsrc2` + `sine`). No fixtures or secrets left in
the repo. Creative Studio v1 behavior unchanged.

## 2. Environment under test

| Property | Value | Source |
|---|---|---|
| Base snapshot | `snap_pabjEZEF5zsaYlQmX3tsgpyMmT3m` (`base-2026-07-21-fonts-system-ffmpeg8.1.2-remotion4.0.489`) | code default + API `status=created` |
| OS | **Amazon Linux 2023.11.20260526** | `/etc/os-release` |
| **glibc** | **2.34** (`ldd (GNU libc) 2.34`, `GNU_LIBC_VERSION=glibc 2.34`) | `getconf` / `ldd` in-sandbox |
| Node | v24.14.1 | `node -v` |
| ffmpeg / ffprobe | 8.1.2 (baked, BtbN GPL) | `ffmpeg -version` |
| Remotion | 4.0.489 | `remotion/package.json` |
| Remotion compositor pkg | `@remotion/compositor-linux-x64-gnu` **present** | `find node_modules/@remotion` |
| Sandbox | 4 vCPU, `@vercel/sandbox` 2.6.1 | driver |

## 3. Method

Disposable driver (`f2b-stage1.tmp.mjs`, removed after run) on branch `spike/f2b-offthreadvideo`:

1. Create a sandbox **from the current base snapshot** (no re-bake).
2. Generate one synthetic clip in-sandbox:
   `ffmpeg -f lavfi -i testsrc2=1920x1080:rate=30:duration=30 -f lavfi -i sine=440:duration=30
   -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest` → valid h264/1080p30 + AAC, 30.0 s, 20.5 MB.
3. Bundle a **minimal experimental** composition (OpeningCard → `<OffthreadVideo>` body →
   ClosingCard, 1920×1080/30/h264) via `@remotion/bundler`, render via `@remotion/renderer`
   `renderMedia`. This composition exists only in the throwaway driver — the production `ListingVideo`
   was never touched.
4. Poll cgroup memory during the render; ffprobe input & output; grab a mid-body frame.

## 4. Result — the decisive failure

The render **failed at body frame 33** (≈ the first frame that extracts video content), with:

```
💡 Remotion requires at least Libc 2.35.
   Get help: https://github.com/remotion-dev/remotion/issues/2439
   ... at Object.executeCommand (@remotion/renderer/.../index.mjs)
Node.js v24.14.1   (exit 1)
STAGE1_RESULT = OFFTHREADVIDEO_FAILED
```

**Root cause (confirmed, not inferred):** `<OffthreadVideo>` extracts frames through Remotion's
native Rust compositor (`@remotion/compositor-linux-x64-gnu`), which is dynamically linked against
glibc and **requires ≥ 2.35**. The base OS provides **2.34**. Verified directly in-sandbox
(`ldd --version` → `2.34`; `getconf GNU_LIBC_VERSION` → `glibc 2.34`). The compositor is only
exercised by video sources — the photo pipeline uses `<Img>`/`renderStill`, never the compositor,
which is why F1 (photo slideshow) renders correctly on this exact artifact.

## 5. Answers to the 10 F2-B questions

1. **Render OffthreadVideo in the current snapshot without re-bake?** → **NO.** glibc 2.34 < 2.35.
2. **Which codecs/containers does the pipeline accept?** → **Undetermined** — blocked before any
   codec was decoded. (ffmpeg 8.1.2 itself supports h264/HEVC/AAC/MP4/MOV; but the Remotion render
   path never reached decode.)
3. **Processing time per clip duration?** → **No valid data.** No render completed. (During the ~1 s
   that ran before the crash, RSS reached ~1.39 GB — not a usable figure.)
4. **Peak memory?** → **No valid data** (same reason).
5. **Support a 90 s clip?** → **Moot** — 30 s did not render; duration is not the limiter, the
   runtime is.
6. **Real MVP limits?** → **Cannot be set from this artifact.** Deferred until a compatible runtime
   exists (§8).
7. **Original audio preserved & synced?** → **Untested** (blocked before render).
8. **Vertical → 1920×1080 blurred-fill without clipping?** → **Untested** (blocked before render).
9. **Can current QA validate this output?** → **Partially.** ffprobe (the QA tool) ran fine on the
   synthetic **input** clip. But QA never got an **output** to validate, and the QA runs *inside the
   same sandbox after render* — so it inherits the same runtime and is equally blocked for video.
10. **Confirm no re-bake needed?** → **NO — a re-bake (or a validated non-compositor path) is
    required.** This is the inverse of the F2-A working assumption.

## 6. Impact on F2-A / ADR-0001

The F2-A architecture assumed the `uploaded_video` source strategy could reuse the current artifact
("no re-bake" — F2-A §2, ADR-0001 Rationale). **That assumption is false.** The two-axis design
(Source Strategy × Render Profile) and the generic `ListingVideoComposition` remain sound — the
finding is purely at the **runtime/base-artifact layer**, not the composition layer. F2-A must record
that **any video source strategy has a base-OS prerequisite (glibc ≥ 2.35)** before the seam work
begins. No F2-A/ADR edits are made in this spike (out of scope); this is flagged for the next gate.

## 7. Fixtures & metrics actually collected

- ✅ Synthetic 16:9 30 s h264/AAC clip generated & ffprobed valid (1920×1080, 30/1 fps, AAC, 30.0 s,
  20.5 MB, 5.46 Mbps). This proves the **generation** side (ffmpeg) works; it is not the blocker.
- ⚠️ Partial render telemetry only: crash at body frame 33; transient RSS ~1.39 GB; `/tmp` usage
  ~666 MB (input clip + Chromium + bundle). **Not** representative render metrics.
- ❌ Duration matrix, vertical blurred-fill, format/codec matrix, negative tests, audio-sync, output
  ffprobe — **not run** (stop rule).

## 8. Options forward (for the next gate — NOT executed here)

1. **Cheapest probe first — swap `<OffthreadVideo>` → `<Video>`.** Remotion's `<Video>` renders via
   the Chrome `<video>` element (no native compositor binary), so it *may* run on glibc 2.34 with **no
   re-bake**. Downsides: less frame-accurate for rendering (Remotion recommends OffthreadVideo),
   possible seek/A-V-sync artifacts. **Recommended next micro-spike** — one sandbox run against the
   current snapshot; if it renders a clean synced clip, the whole re-bake may be avoidable.
2. **Re-bake on a glibc ≥ 2.35 base.** Vercel's `node24` runtime is AL2023 (glibc 2.34), so this
   requires a **custom base image** (`Sandbox.create({ image })` / `CREATIVE_STUDIO_SANDBOX_IMAGE`)
   built on Debian 12 (glibc 2.36) or Ubuntu 22.04 (glibc 2.35), re-installing Node 24 + ffmpeg 8.1.2
   + Chromium + the Lixtara system fonts (dnf→apt) and re-running the font/render gates. Larger,
   bounded effort; re-validates the whole toolchain on a new OS.
3. **Remotion musl / other variants** — not applicable (the gnu compositor's requirement is the
   issue; musl needs a musl base). Rejected.

**Recommendation:** run Option 1 as a tiny follow-up spike **before** committing to Option 2. Decide
the MVP duration/format limits *after* a runtime that renders video exists.

## 9. Negative tests

Not run — the positive path failed first (stop rule). The one "negative-ish" signal obtained is
clean and distinguishable: the failure is a **runtime/libc incompatibility** (`Libc 2.35` message),
not a codec/container/harness error — an unambiguous, well-scoped blocker.

## 10. Risks & safety

No Production or Preview surface touched; no env var, migration, bucket, cron, secret, deploy, PR, or
merge. All artifacts were in-sandbox synthetic media destroyed with the sandbox. Driver files were
transient (`*.tmp.mjs`, removed). Branch `spike/f2b-offthreadvideo` has **0 commits over main** and is
safe to delete.

## 11. Reproduction

On `spike/f2b-offthreadvideo`, from repo root, with `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/
`VERCEL_PROJECT_ID` exported and `VERCEL_OIDC_TOKEN` unset: create a sandbox from
`snap_pabjEZEF5zsaYlQmX3tsgpyMmT3m`, generate the testsrc2+sine clip, bundle a composition whose body
is `<OffthreadVideo src={staticFile(clip)} />`, and `renderMedia({codec:"h264"})`. It fails at the
first body frame with the `Libc 2.35` error. `ldd --version` in the same sandbox reports 2.34.

## 12. Decision

⛔ **No-Go on the current artifact.** ⚙️ **Conditional-Go** for the Property Video Pipeline, gated on
a base-runtime decision: **either** prove `<Video>` renders acceptably on the current snapshot
(Option 1, cheap), **or** re-bake on a glibc ≥ 2.35 base (Option 2). Duration/format limits (Q5–Q8)
are deferred to that follow-up. F2-A's "no re-bake" assumption must be corrected.

## 13. Next step (requires separate authorization)

A ~1-run micro-spike: `<Video>` (not `<OffthreadVideo>`) rendering the same synthetic 30 s clip on
the **current** snapshot, checking output validity + A/V sync via ffprobe. Outcome decides
Option 1 vs Option 2. **Not** authorized by this gate — proposed only.

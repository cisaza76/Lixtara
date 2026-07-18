# Creative Studio — Sandbox Render Artifact (definition + bake recipe + acceptance criteria)

**Status:** **architecture/definition implemented** (Launch Gate preflight Step 0, 2026-07-17).
**Production values (ffmpeg version/URL/SHA-256) and the real bake are pending owner approval — NOT
done.** This document is the durable spec for the prebuilt Vercel Sandbox base the video worker
renders in. No production artifact exists yet (`BASE_ARTIFACT_VERSION = "unbaked-pending-prebuilt-base"`).
Nothing here is evidence that a bake has occurred.

## What the artifact is
A **Vercel Sandbox base** (referenced by `snapshotId`, or an `image`) with everything a render
needs **baked in once**, so per-job cost is render-only (no npm-install-per-render).

- **Baked (one-time):** Node 24 (Amazon Linux 2023, Node v24.14.1); the pinned Remotion packages
  (`remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/fonts` — all `4.0.489`);
  `react`/`react-dom` `19.2.4`; Chromium Headless Shell (`ensureBrowser()`) + its OS libs; a
  **pinned, checksum-verified** ffmpeg/ffprobe static build; `xz`/`tar`.
- **Shipped per render (NOT baked):** the `src/remotion/` composition tree, the source photos,
  `render.mjs`, and `render-input.json` (the secret-free manifest). This keeps `TEMPLATE_VERSION`
  independent of `BASE_ARTIFACT_VERSION`.

## Target runtime
Vercel Sandbox `runtime: "node24"`, **4 vCPU / 8 GB**, `amd64`, region `iad1`. One-time prep in the
Gate B2 spike measured **~38 s / ~362 MB ingress** (paid once, not per video).

## Pinned versions
| Component | Pin | Notes |
|---|---|---|
| Node | 24 (v24.14.1) | Vercel Sandbox `node24` runtime |
| remotion / bundler / renderer / fonts | **4.0.489** (exact, no caret) | matches `RENDERER_VERSION` in `src/lib/video-engine/versions.ts` |
| react / react-dom | **19.2.4** (decision) | **aligned to the app** (`package.json`). Remotion 4.0.489 peer is `react >=16.8.0`; the composition uses no React-18/19-only API — so the spike's `18.3.1` drift is removed, not preserved. **Final validation occurs during the first authorized bake** (a real render with React 19.2.4). |
| @vercel/sandbox | 2.6.1 | |
| ffmpeg/ffprobe | **Pinning mechanism implemented** (fail-closed SHA-256, no "latest") | exact **version / URL / SHA-256 are production values pending owner approval** — filled once via an authorized download (see recipe + Open items) |

## Bake recipe (hardened)
The executable recipe lives alongside this doc; the canonical copy used for the Step-0 preflight is
`bake-sandbox-base.mjs` (SHA-256 `44189f55bf02c08a2796f8f3bae2a3f72d7ee2e2215d5ab7c6cb765f1745f991`).
Key properties: pinned deps; Chromium OS libs via `dnf`; `ensureBrowser()`; **ffmpeg pinning is
fail-closed** — it installs only if `sha256sum -c` passes (`set -e` aborts otherwise), and the
`bake()` entry refuses to run while `FFMPEG.sha256` is a placeholder. **The exact ffmpeg
version/URL/SHA-256 are not yet pinned** — they are production values to be set once via an
authorized download. The actual `snapshot()` + recording of `snapshotId` is the owner bake step,
not part of Step 0.

## Reproducibility
- The **recipe** is byte-stable and hashed (above). The **VM snapshot is NOT byte-reproducible** —
  the same finding as the spike's output MP4s, whose checksums differ (encoder metadata/timestamps)
  though codec/dimensions/fps/duration are identical. Byte-identity is not a property; **functional
  equivalence** is, guaranteed by the exact-pinned deps + the checksum-verified ffmpeg + per-render
  ffprobe QA.

## Compatibility evidence
- **Local (Step 0):** `bundle()` + `selectComposition()` PASS — `ListingVideo` compiles, loads,
  validates its input schema, and computes metadata **1920×1080 · 30 fps · 285 frames (9.5 s, 1 photo)**.
- **Full frame-render in the real target:** Gate B2 spike **3/3** (ffprobe h264/1280×720/30fps) and
  Gate D1 E2E (real Sandbox render of *this* composition, ffprobe **h264/1920×1080/30fps**). Vendored
  fonts (woff2, no network) and staged photo assets confirmed.

## Security
- Secret scan of the recipe and the shipped composition source (`src/remotion`): **zero** secret-shaped
  literals. The per-render manifest is **secret-free by design** (enforced by 9 assertions in
  `manifest.test.ts`). No credentials are baked; Vercel OIDC / Supabase keys are **runtime-only** (env),
  never written into the artifact.

## Integration / versioning / rollback
- **Worker reference:** `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` (preferred) or
  `CREATIVE_STUDIO_SANDBOX_IMAGE`. `resolveSandboxBaseArtifactFromEnv()` **fails closed** if unset —
  never falls back to a stock runtime.
- **Version tag:** `BASE_ARTIFACT_VERSION` (`src/lib/video-engine/versions.ts`). Stamped onto every
  render's output (`baseArtifactVersion`) → recorded in each video Asset's provenance.
- **No silent replacement:** a new artifact requires an explicit `BASE_ARTIFACT_VERSION` bump **and**
  setting the env var; every video records which version produced it.
- **Rollback:** keep the prior `snapshotId` + its `BASE_ARTIFACT_VERSION`; revert the env var to roll
  back (no DB change). `provenance.baseArtifactVersion` is the audit key for "which artifact produced
  this video".

## Artifact Acceptance Criteria
Two states, kept explicitly separate so this document is **never** mistaken for evidence that a bake
has happened. **Architecture implemented (☑)** = designed/coded/documented at preflight Step 0.
**Operational validation (☐)** = only true after the first authorized real bake.

### A. Architecture implemented — preflight Step 0
- [x] **Recipe versioned** — `bake-sandbox-base.mjs` committed + SHA-256 recorded; deps exact-pinned (no caret).
- [x] **Pinning mechanism implemented** — ffmpeg install is fail-closed on SHA-256 (`sha256sum -c`), no "latest"; `bake()` refuses to run while the checksum is a placeholder.
- [x] **React version aligned (decision)** — artifact React set to the app's 19.2.4 (rationale above).
- [x] **Reproducible by construction** — exact-pinned deps + checksum-verified ffmpeg; VM-snapshot non-byte-identity documented (encoder/VM metadata only).
- [x] **Secret scan clean** — recipe + shipped composition (`src/remotion`) + manifest carry no secrets; credentials runtime-only.
- [x] **Rollback documented** — prior `snapshotId` + `BASE_ARTIFACT_VERSION` retained; env-var revert path.
- [x] **Provenance mechanism in code** — `SandboxRemotionProvider` stamps `baseArtifactVersion` on every render output.

### B. Operational validation — only after the first authorized bake (NOT done)
- [ ] **Production checksum recorded** — exact ffmpeg version + immutable URL + real SHA-256 pinned (one authorized download).
- [ ] **Baked artifact validated (render)** — a real render in the baked artifact, with React 19.2.4, produces an ffprobe-valid h264/1920×1080/30fps MP4 (in-target).
- [ ] **Reproducibility confirmed on real bakes** — two bakes compared; functional equivalence shown.
- [ ] **Provenance recorded on a real Asset** — `baseArtifactVersion` present on an actually-produced video Asset.

## Open items before the bake (owner-gated)
1. **Pin the ffmpeg SHA-256** — choose the exact ffmpeg version + immutable URL, compute its SHA-256
   once (`curl -fsSLo f.tar.xz "$URL" && sha256sum f.tar.xz`), and set `FFMPEG.sha256`. (The single
   download this needs is owner-authorized.)
2. **Confirm React 19.2.4 in the bake** — a real render in the baked artifact with React 19.2.4
   (matching the app), producing an ffprobe-valid MP4 (D1 evidence supports it; confirm in the bake).
3. **The bake itself** — create Sandbox → run recipe → `snapshot()` → record `snapshotId` → bump
   `BASE_ARTIFACT_VERSION` → set the env var. Owner action; needs Vercel Sandbox access. Not authorized yet.

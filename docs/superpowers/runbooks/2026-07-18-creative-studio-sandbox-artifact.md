# Creative Studio — Sandbox Render Artifact (definition + bake recipe + acceptance criteria)

**Status:** **permanent artifact baked + validated — Production Candidate (2026-07-19).** The
ffmpeg pin is set (checksum verified 2026-07-18). The permanent, non-expiring snapshot
`snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC` (region `iad1`) was baked 2026-07-19 and passed all 10 recipe
gates; `BASE_ARTIFACT_VERSION = "base-2026-07-19-ffmpeg8.1.2-remotion4.0.489"`. This document is the
durable spec for the prebuilt Vercel Sandbox base the video worker renders in. **The artifact is a
Production Candidate — NOT yet promoted:** it is not wired to any environment
(`CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID`/`_IMAGE` still unset), and end-to-end integration, a real
produced Asset, and production activation are still pending.

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
Vercel Sandbox `runtime: "node24"`, **4 vCPU / 8 GB** (2048 MB per vCPU), `amd64`, region `iad1`
(**target**; region is not a `Sandbox.create` input in `@vercel/sandbox` 2.6.1 — placement follows
the project/deployment, so it is not set as a create-time knob). One-time prep in the Gate B2 spike
measured **~38 s / ~362 MB ingress** (paid once, not per video).

## Pinned versions
| Component | Pin | Notes |
|---|---|---|
| Node | 24 (v24.14.1) | Vercel Sandbox `node24` runtime |
| remotion / bundler / renderer / fonts | **4.0.489** (exact, no caret) | matches `RENDERER_VERSION` in `src/lib/video-engine/versions.ts` |
| react / react-dom | **19.2.4** (decision) | **aligned to the app** (`package.json`). Remotion 4.0.489 peer is `react >=16.8.0`; the composition uses no React-18/19-only API — so the spike's `18.3.1` drift is removed, not preserved. **Final validation occurs during the first authorized bake** (a real render with React 19.2.4). |
| @vercel/sandbox | 2.6.1 | |
| ffmpeg/ffprobe | **8.1.2** — BtbN linux64 **GPL** (`n8.1.2-22-g94138f6973`, extra-version 20260717); fail-closed SHA-256 `ca1b5e…2e306e` | Checksum verified locally 2026-07-18; **runtime validation deferred to the first authorized bake**. `--enable-libx264` present (static evidence: embedded config line + libx264 encoder strings; binary not executed on the arm64 host). GPL distribution note still open. |

## Bake recipe (hardened)
The executable recipe lives alongside this doc; the canonical copy used for the Step-0 preflight is
`bake-sandbox-base.mjs` (SHA-256 `7787b1c6d7c6eb6e7e86e6ed67a90d5da573327fbe4ffcb01dc5a5380c204494`).
Key properties: pinned deps; Chromium OS libs via `dnf`; `ensureBrowser()`; **ffmpeg pinning is
fail-closed** — it installs only if `sha256sum -c` passes (`set -e` aborts otherwise), and the
`bake()` entry refuses to run while `FFMPEG.sha256` is a placeholder. **The ffmpeg version/URL/SHA-256
are now pinned** (BtbN `8.1.2` linux64 GPL, checksum verified locally 2026-07-18; the install path
targets the BtbN `bin/` layout). **`bake()` is now a single self-validating, fail-closed pipeline**
(v3): after preparing the artifact it runtime-verifies `node`/`ffprobe`/`ffmpeg`, asserts `libx264`
is among the encoders, runs a real Remotion `codec:"h264"` smoke render (a minimal self-contained
1920×1080/30fps composition — no Supabase/listing/photos/secrets), and ffprobe-asserts the MP4 is
`h264 / 1920×1080 / 30fps` — all **before** `snapshot()`. Any failure throws before the snapshot, so
a bad artifact can never be produced or promoted. `bake()` then calls `snapshot()` (which stops the
session) and emits the `snapshotId`. **Recording that `snapshotId` into
`CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` and bumping `BASE_ARTIFACT_VERSION` remain separate, later
owner steps — not part of running `bake()`.**

**Auditable gate evidence:** the `sh` gate runner emits, for every gate, a `GATE START` line and a
`GATE PASS/FAIL` line with the gate name, exit code and duration, followed by the (tail-capped)
stdout/stderr — so a bake produces a captured, per-gate audit trail (node/ffmpeg/ffprobe banners,
`libx264` presence, the smoke-render result, and the ffprobe `codec_name`/`width`/`height`/
`r_frame_rate` fields), not just an inference from "the snapshot exists". The gate commands already
narrow their own output to the relevant evidence, so nothing dumps a full build log, and no env var
or secret is ever printed. Fail-closed behaviour is unchanged — a non-zero exit still throws before
any downstream step or `snapshot()`.

**Non-expiring, production-candidate snapshots:** `Sandbox.create` is called with
`snapshotExpiration: 0` (confirmed in `@vercel/sandbox` 2.6.1: "Use `0` for no expiration"). Snapshots
produced by this recipe therefore **never expire** and are intended to be **production candidates** —
not the platform's default ~30-day TTL. (Nothing else about the pipeline changes: same pins, deps,
commands, gates, logging, smoke composition, order, `snapshot()` condition, resources and runtime.)

### Bake history
- **Permanent bake — 2026-07-19 · Production Candidate.** Recipe SHA-256
  `7787b1c6d7c6eb6e7e86e6ed67a90d5da573327fbe4ffcb01dc5a5380c204494` (the `snapshotExpiration: 0`
  version). Produced the permanent snapshot **`snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC`** — region `iad1`,
  `createdAt` `2026-07-19T17:24:01.048Z`, `sizeBytes` `1 065 730 813`, **`expiresAt` = undefined
  (NON-EXPIRING, confirmed via `Snapshot.get` and `Snapshot.list`)**. **All 10 gates passed**
  (npm-install, chromium-os-deps, ensure-chromium, ffmpeg-pinned, verify-node, verify-ffprobe,
  verify-ffmpeg, verify-libx264, render-smoke, ffprobe-smoke → `codec_name=h264`/`width=1920`/
  `height=1080`/`r_frame_rate=30/1`), with node `v24.14.1`, ffmpeg/ffprobe `n8.1.2-…-20260717`,
  runtime `libx264` present, `ffmpeg.tar.xz: OK`, and `RENDER_SMOKE_OK`. Tagged
  `BASE_ARTIFACT_VERSION = "base-2026-07-19-ffmpeg8.1.2-remotion4.0.489"`. **Status: Production
  Candidate — recorded here, NOT promoted:** `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID`/`_IMAGE` remain
  unset; no deploy, flags, cron, or migration.
- **First validated bake — 2026-07-19 (validation-only, NOT promoted).** Ran the self-validating
  recipe end-to-end and produced the temporary snapshot **`snap_sLqjP5Eha6U7JnTTKai5LVLvHvtV`**
  (region `iad1`, `sizeBytes` 1 071 233 423). **All 10 gates passed** (npm-install, chromium-os-deps,
  ensure-chromium, ffmpeg-pinned, verify-node, verify-ffprobe, verify-ffmpeg, verify-libx264,
  render-smoke, ffprobe-smoke → `codec_name=h264`/`width=1920`/`height=1080`/`r_frame_rate=30/1`).
  This snapshot predates the `snapshotExpiration: 0` change and therefore carries the default
  **~30-day TTL — it expires 2026-08-18** and **was NOT promoted**. It stands only as evidence that
  the recipe, pins and gates work, and as an integration fallback until a permanent snapshot exists
  and is validated. **Do not use `snap_sLqjP5Eha6U7JnTTKai5LVLvHvtV` as a production reference.**

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

### B. Operational validation — permanent bake done 2026-07-19; remaining items still pending
- [x] **Production checksum recorded** — exact ffmpeg version + immutable URL + real SHA-256 pinned (authorized download 2026-07-18). Integrity closed; runtime validation still pending the bake.
- [x] **Baked artifact validated (render)** — the permanent bake's Remotion `codec:"h264"` render, run **in the baked artifact** with the baked React 19.2.4, produced an ffprobe-valid **h264/1920×1080/30fps** MP4 (smoke composition; the full `ListingVideo` in-target render is the Gate D1 evidence above). Snapshot `snap_8gmMWE8S5NgT5RfM4qfIiMztMfnC`, 2026-07-19.
- [ ] **Reproducibility confirmed on real bakes** — two bakes compared; functional equivalence shown. *(Not claimed: two bakes exist and both emitted h264/1920×1080/30fps, but no controlled reproducibility comparison was run.)*
- [ ] **Provenance recorded on a real Asset** — `baseArtifactVersion` present on an actually-produced video Asset. *(Pending a real produced Asset — not demonstrated by the bake.)*

## Open items before the bake (owner-gated)
1. ~~**Pin the ffmpeg SHA-256**~~ — **DONE 2026-07-18.** Pinned to BtbN `n8.1.2-22-g94138f6973`
   linux64 GPL (`8.1.2`); local SHA-256 matched the published `ca1b5e…2e306e` exactly (`sha256sum -c`
   fail-closed OK). Install path fixed for the BtbN `bin/` layout. **Runtime validation (`ffmpeg
   -version`/`-encoders`) deferred to the first authorized bake** — not run here (arm64 host).
   **GPL note remains open:** the GPL v3 build reduces some distribution scenarios for internal
   server-side use but does not substitute a specific legal review before distributing the binary or
   artifact outside the internal environment.
2. **Confirm React 19.2.4 in the bake** — a real render in the baked artifact with React 19.2.4
   (matching the app), producing an ffprobe-valid MP4 (D1 evidence supports it; confirm in the bake).
3. **The bake itself** — create Sandbox → run recipe → `snapshot()` → record `snapshotId` → bump
   `BASE_ARTIFACT_VERSION` → set the env var. Owner action; needs Vercel Sandbox access. Not authorized yet.

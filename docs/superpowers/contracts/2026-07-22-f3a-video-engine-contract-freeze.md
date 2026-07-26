# F3-A — Video Engine Contract Freeze

- **Date:** 2026-07-22
- **Scope:** the pure contracts landed in F3-A Step 1 (8 modules + 7 test suites, 68 tests;
  435/435 green; zero production files modified; zero production wiring).
- **Status:** **FROZEN.** This document is the authoritative surface for the uploaded_video ×
  standard MVP. Documentation only — no code/tests/migrations/deps changed by this freeze.
- **Source of truth:** the modules under `src/lib/video-engine/` listed in §7. Where this doc and the
  code ever disagree, the code wins and this doc is a defect to fix.

> **Change rule (binding).** No later step may modify these contracts, their discriminants,
> invariants, or module boundaries **without expressly documenting the modification and obtaining
> prior authorization.** A change that is not documented + pre-authorized is a gate violation.

---

## 1. Frozen public types

From `media-metadata.ts`:
```ts
interface SourceVideoMetadata {
  container: string;          // ffprobe format.format_name (alias list; membership-checked)
  videoCodec: string | null;  // null ⇒ no video stream
  audioCodec: string | null;  // null ⇒ no audio stream (audio optional)
  width: number; height: number;   // CODED dims (pre-rotation)
  fps: number;                // reduced from r_frame_rate
  durationSeconds: number;
  bytes: number;
  rotationDegrees: number;    // 0 | 90 | 180 | 270 (applied at preparation, not at limit-check)
}
```

From `source-strategy.ts` — the prepared-video contract (see §"Prepared source" for `path` policy):
```ts
interface PreparedVideoSource {
  path: string;               // INTERNAL, TEMPORARY runtime ref — never a public URL / durable id
  width: 1920; height: 1080; fps: 30;
  durationSeconds: number;
  videoCodec: "h264";
  audioCodec: "aac" | null;
  hasAudio: boolean;
  sourceHash: string;             // sha256 of the DURABLE source bytes (retry-stable identity)
  preparationFingerprint: string; // deterministic hash of the preparation plan
  sourceMetadata: SourceVideoMetadata;
  transformations: string[];      // e.g. ["rotate 90°","blurred-fill 9:16→16:9","fps 24→30"]
  ffmpegVersion: string;
  runtimeVersion: string;         // base-artifact snapshot tag + pinned Remotion/@remotion/media
  preparedBytes: number;          // ephemeral temp size
}
interface SelectedPhoto { assetId; storageBucket; storagePath; roomLabel? }
interface SelectedUploadedVideo { assetId; listingId; ownerId; storageBucket; storagePath; bytes; mime }
interface PreparedPhoto { localPath; stagedRef; roomLabel? }
```

From `qa-contract.ts` — extends the existing `ExpectedTechnicalSpec` (qa.ts) additively, no qa.ts change:
```ts
interface ExpectedVideoQaSpec extends ExpectedTechnicalSpec {
  audioExpected: boolean;                    // photo ⇒ false; uploaded_video ⇒ source.hasAudio
  audioCodec?: "aac";                        // present only when audioExpected
  aspect?: { width: number; height: number };// 16:9 for standard
  audioVideoDurationToleranceSec?: number;   // a/v drift allowance
}
```

## 2. Discriminated unions

```ts
// composition-input.ts — the ONLY shape the shared composition accepts.
type CompositionInput =
  | { source: "photo_slideshow"; property; priceLabel; photos: {url; roomLabel?}[]; brand; cta; badge }
  | { source: "uploaded_video";  property; priceLabel; videoSrc: string; durationSeconds: number;
                                  hasAudio: boolean; brand; cta; badge };
// NO layout / aspect / objectFit field — layout is resolved UPSTREAM; the composition just plays videoSrc.

// source-strategy.ts
type SelectedSource =
  | { strategy: "photo_slideshow"; photos: SelectedPhoto[] }
  | { strategy: "uploaded_video";  asset: SelectedUploadedVideo };

type PreparedSource =
  | { strategy: "photo_slideshow"; photos: PreparedPhoto[] }
  | { strategy: "uploaded_video";  video: PreparedVideoSource };
```
Discriminants are frozen: `CompositionInput.source`, `SelectedSource.strategy`, `PreparedSource.strategy`.
Exhaustiveness is compile-time-enforced (assertNever) and unit-tested.

## 3. Registries

```ts
// source-strategy.ts
SOURCE_STRATEGIES = ["photo_slideshow","uploaded_video"] as const;   // type SourceStrategy
SOURCE_STRATEGY_REGISTRY: Record<SourceStrategy, {
  id; requiresPreparation: boolean; sourceKind: "photo"|"video"; compositionInputSource;
}>
//   photo_slideshow → requiresPreparation:false, sourceKind:"photo"
//   uploaded_video  → requiresPreparation:true,  sourceKind:"video"

// render-profiles.ts
RENDER_PROFILES = ["standard"] as const;                             // type RenderProfile
RENDER_PROFILE_REGISTRY: Record<RenderProfile, RenderProfileSpec>
//   standard → 1920×1080/30, h264/aac, compositionId:"ListingVideo", durationToleranceSec:2,
//              expectedQaSpec(input, totalOutputDurationSeconds) → ExpectedVideoQaSpec
```
**Independence (proven):** the two registries share no keys and no cross-references; `expectedQaSpec`
reads only the CompositionInput's public fields, never the strategy id. A new strategy needs no new
profile; a new profile needs no new strategy. All strategies drive the single shared composition
`"ListingVideo"` — never a per-strategy/per-profile composition.

## 4. MVP limits (`video-source-limits.ts`)

| Policy | Value | Unit |
|---|---|---|
| max duration | 60 | seconds |
| max file size | 300 (`314_572_800`) | MB (bytes) |
| max resolution | 3840 long-edge × 2160 short-edge | px, **orientation-agnostic** |
| container | `mp4` | — |
| video codec | `h264` | — |
| audio codec | `aac` or none | — |
| video stream | required | — |
| audio stream | optional | — |
| **output** | 1920×1080, 30 fps, h264/aac | — |

**Orientation rule:** the check sorts the two edges, so vertical 4K (2160×3840) and horizontal 4K
(3840×2160) are both accepted; 8K and ultra-wides (long edge > 3840 or short edge > 2160) are rejected.
The limit is on **dimensions, never orientation**. `checkSourceLimits(meta)` returns ALL violations
(pure; never throws; does not judge corruption — that needs a decode pass). Reconciliation: the 300 MB
input cap is stricter than and independent of the existing 500 MB output storage ceiling.

## 5. States & legal transitions (`video-job-states.ts`)

Target machine (happy-path spine):
```
queued → running → validating → preparing → rendering → qa → uploading → completed
```
`running` = general **job acquisition/activation** (claim). `validating`, `preparing`, `rendering`,
`qa`, `uploading` = **observable technical phases**. `running` is NOT removed: it must reconcile with
the production machine and preserve the `photo_slideshow` path (which will keep `running → rendering`).

Legal transitions (frozen):
```
queued:     [running, cancelled]
running:    [validating, failed, cancelled]
validating: [preparing, failed, cancelled]
preparing:  [rendering, failed, cancelled]
rendering:  [qa, failed, cancelled]
qa:         [uploading, failed]          # NO cancel edge
uploading:  [completed, failed]          # NO cancel edge
completed / failed / cancelled: []       # terminal
```
Invariants: no stage-skipping; `qa`/`uploading` cannot be cancelled (finish a near-done
render/upload); terminal states have no outgoing edges. An illegal transition is reported as
`VIDEO_STATE_TRANSITION_INVALID` (via `assertVideoTransition` / `VideoStateTransitionError`).

## 6. Error catalog & retryability (`video-errors.ts`)

Categories: `user_input | authorization | preparation | runtime | render | qa | persistence | primary | state`.

| Code | Category | Retryable | Seller-facing |
|---|---|---|---|
| VIDEO_SOURCE_MISSING | user_input | no | yes |
| VIDEO_CONTAINER_UNSUPPORTED | user_input | no | yes |
| VIDEO_CODEC_UNSUPPORTED | user_input | no | yes |
| VIDEO_STREAM_MISSING | user_input | no | yes |
| VIDEO_DURATION_EXCEEDED | user_input | no | yes |
| VIDEO_FILE_TOO_LARGE | user_input | no | yes |
| VIDEO_RESOLUTION_EXCEEDED | user_input | no | yes |
| VIDEO_CORRUPT | user_input | no | yes |
| VIDEO_SOURCE_UNAUTHORIZED | authorization | no | no |
| VIDEO_PREPARATION_FAILED | preparation | no | no |
| VIDEO_PREPARED_SOURCE_INVALID | preparation | no | no |
| **VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED** | runtime | **yes** | no |
| VIDEO_RENDER_FAILED | render | no | no |
| VIDEO_QA_FAILED | qa | no | no |
| VIDEO_PRIMARY_ASSET_INVALID | primary | no | no |
| VIDEO_STATE_TRANSITION_INVALID | state | no | no |

`VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED` is the ONLY retryable code and must **never** be collapsed
into `VIDEO_RENDER_FAILED` (gate D1). Persistence/shared-runtime origins reuse the existing pipeline
codes (`STORAGE_UPLOAD_FAILED`/`STORAGE_VERIFY_FAILED`/`ASSET_CREATE_FAILED`/`SANDBOX_CREATE_FAILED`/
`ASSET_DOWNLOAD_FAILED`/`FONT_STRATEGY_MISMATCH`) — mirrored in `SHARED_PIPELINE_ERROR_CATEGORY` by
plain string keys (no `@/lib/creative-jobs` import — §9).

## 7. Layer responsibilities (ownership)

| Module | Owns |
|---|---|
| `source-strategy.ts` | Source SELECTION + the logical SHAPE of preparation (Seam A/B): what the source is and what a prepared source looks like. |
| `video-source-limits.ts` | Input ACCEPTANCE POLICY: the limits + the pure limit checker → typed violations. |
| `media-metadata.ts` | Observed TECHNICAL FACTS about a source (the ffprobe shape). No policy, no logic. |
| `composition-input.ts` | The SINGLE shape the shared composition accepts (Seam C). |
| `render-profiles.ts` | Output SPECIFICATION (Seam D): dimensions/fps/codecs/QA expectation per profile. |
| `qa-contract.ts` | The audio-aware OUTPUT QA EXPECTATION type. |
| `video-job-states.ts` | The TARGET pipeline state machine + legal transitions. |
| `video-errors.ts` | The stable FAILURE TAXONOMY (codes, categories, retryability). |

## 8. Architectural invariants

1. **Two orthogonal axes** — Source Strategy (where content comes from) × Render Profile (what output
   shape). Combinations grow multiplicatively; code grows additively. One shared composition
   (`"ListingVideo"`), never per-strategy/per-profile compositions.
2. **The composition never resolves layout** — no aspect/rotation/letterbox/blurred-fill/objectFit in
   any composition-facing type. For uploaded_video, `videoSrc` is already normalized to 1920×1080
   upstream (F2-D Strategy C).
3. **FFmpeg + `@remotion/media` internals never cross their layer** — preparation exposes only opaque
   plans/handles; the composition imports `@remotion/media`, nothing above it does.
4. **Prepared source is ephemeral** (D2) — lives only in the job's sandbox workspace, regenerated from
   the durable source on every retry, never persisted as a durable/public object.
5. **Profiles don't branch on strategy identity** — only on the CompositionInput's public fields.
6. **Immutability of Assets** — the Primary Marketing Video is a separate pointer concept (D3), never a
   mutable `assets` column.
7. **Duration single-source-of-truth** — the composition's `calculateMetadata` owns total duration;
   `expectedQaSpec` receives it, never recomputes it.

## 9. Allowed / forbidden module dependencies

- **Forbidden:** any `src/lib/video-engine/**` file (except the whitelisted `pipeline.ts` and
  `worker-deps.ts`) importing `@/lib/creative-jobs` — enforced by `produce-asset.test.ts`'s
  module-isolation guard (covers even `import type`). The freeze modules honor this: cross-references
  to shared error codes use plain string literals, not imports.
- **Allowed (type-only, additive):** `qa-contract.ts` → `qa.ts` (`ExpectedTechnicalSpec`).
- **Internal DAG (acyclic):** `media-metadata` ← `video-source-limits`; `video-errors` ←
  `video-source-limits`, `video-job-states`; `composition-input` ← `source-strategy`, `render-profiles`;
  `qa-contract` ← `render-profiles`; `video-source-limits` ← `render-profiles`, `source-strategy`. No
  module imports Remotion. No production module imports any freeze module yet (inert, like `wiring.ts`).

## 10. Standalone now vs. later reconciliation with `creative-jobs`

| Contract | Now | Later (separately authorized) |
|---|---|---|
| `video-job-states.ts` | STANDALONE target machine; **not** the running machine | Reconcile `validating`/`preparing` + edges into `creative-jobs/states.ts` (+ migration), keeping `running → rendering` for photo_slideshow |
| `video-errors.ts` | STANDALONE catalog | Merge the `VIDEO_*` codes + classes into `creative-jobs/errors.ts` `CreativeJobErrorCode` + `ERROR_CLASS` |
| `composition-input.ts` | In `video-engine`, unwired | Relocate/wire into the generalized composition (+ zod), avoiding a `remotion ↔ video-engine` cycle |
| `qa-contract.ts` | Type-only extension | `parseFfprobe` gains the audio/aspect/coherence checks |
| `source-strategy`/`render-profiles` | Registries, no select/prepare fns | Bind concrete `selectSourceForStrategy` / preparation / profile-driven `produceVideoAsset` |

Until reconciled, the STANDALONE contracts do **not** govern the running worker/DB — the production
`creative-jobs/{states,errors}.ts` remain the source of truth for live jobs.

## 11. Contract versioning policy

- The frozen surface is versioned by `INPUT_SCHEMA_VERSION` (video-engine `versions.ts`) for the
  `CompositionInput`/manifest shape, plus the additive registries. Step 1 did **not** bump it (no wired
  schema yet); the composition-generalization step will bump `INPUT_SCHEMA_VERSION "1"→"2"`.
- Any change to a discriminant value, a frozen field's type/meaning, a legal transition, an error
  code's category/retryability, or a module boundary is a **breaking** contract change: it requires a
  documented amendment to this file + prior authorization, and (where wired) a version bump.
- Additive changes (a new strategy, a new profile, a new error code) are non-breaking **iff** they
  respect the invariants in §8 and the boundaries in §9; they still get a one-line amendment here.

## 12. Change rule (restated, binding)

> Ningún paso posterior puede modificar estos contratos, sus discriminantes, invariantes o fronteras
> sin documentar expresamente la modificación y obtener autorización previa.

---

## Precisions requested

### Prepared source — `PreparedVideoSource.path`
Kept as-is in this freeze. Documented policy:
- it is an **internal, temporary runtime reference** (the ephemeral prepared file in the job's sandbox
  workspace);
- it is **never a public URL**;
- it is **never persisted as a durable identifier**;
- it **must not cross the job boundary**;
- a later evolution MAY encapsulate it as an opaque `PreparedVideoHandle` **without changing the
  contract's meaning**. The type is **not** changed in this closure.

### States
The machine `queued → running → validating → preparing → rendering → qa → uploading → completed` is
retained. `running` = general job acquisition/activation; `validating`/`preparing`/`rendering`/`qa`/
`uploading` = observable technical phases. `running` is **not** removed now — it must reconcile with the
production machine and preserve the `photo_slideshow` path.

### Staged QA — four evidence levels
The system will carry four levels of technical evidence:
```
source metadata → prepared-source metadata → rendered-output metadata → final asset metadata
```
`ExpectedVideoQaSpec` initially governs **output** validation only; **provenance must retain the full
chain** for diagnosis/audit. No new QA checks are implemented in this closure.

---

## Confirmation

- Production tree unchanged (no code/tests/migrations/deps touched by this freeze — documentation only).
- Contracts identical to the Step-1 code (this doc is a consolidation, not an edit).
- **STOP.** Step-2 proposal follows separately; awaiting authorization before executing it.

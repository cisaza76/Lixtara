# F3-A — Uploaded Video MVP Core — Implementation Plan (PLANNING ONLY)

- **Gate:** F3-A — Uploaded Video MVP Core. Backend + render core only; **no UI**.
- **Branch:** `feat/f3a-uploaded-video-core` (created from `main` `0f6c58206b774a5d791619e5b3b956963cd20519`).
- **Working tree:** tracked files clean (only untracked `docs/*.md` from prior gates).
- **First combination:** `source_strategy = uploaded_video` × `render_profile = standard`.
- **Status:** this document is the F3-A step-1 deliverable. **No app code is written yet** — awaiting
  authorization to execute.

Decisions accepted (context): engine `@remotion/media <Video disallowFallbackToOffthreadVideo>`;
current AL2023 snapshot (no re-bake); vertical/odd aspect normalized by an **FFmpeg pre-pass**
(pre-baked blurred-fill, F2-D Strategy C); the composition receives an already-16:9 video and does
**not** use `objectFit` to solve layout.

---

## 0. Key design decisions surfaced by the code map (need a nod)

These three are the only choices where I diverge from a naive reading; everything else follows the
existing architecture mechanically.

- **D1 — `@remotion/media` reaches the sandbox via a one-package in-sandbox install, not a re-bake.**
  The permanent snapshot `snap_pabjEZEF…` has `remotion/@remotion/bundler/@remotion/renderer` baked
  but **not** `@remotion/media`. `bundle()` runs webpack *inside* the sandbox, so the package must be
  in the sandbox `node_modules` at bundle time. Re-bake is out of scope for F3-A, so the provider runs
  `npm install @remotion/media@4.0.489 --no-save` once per render (~1 s — measured in F2-C). This is
  exactly what the F2-C/F2-D spikes already relied on. **Follow-up (separate gate): bake it into the
  next artifact** to restore the zero-install property. Recorded as a P1 in provenance + risks.
- **D2 — the normalized (prepared) video is an ephemeral in-sandbox file, never a bucket object.**
  It exists only inside the render sandbox (produced by FFmpeg, consumed by Remotion, ffprobed for QA)
  and dies with `sandbox.stop()`. Satisfies gate §5 (temporary, cleaned on success *and* failure, never
  publicly accessible) with zero new storage surface. Retries re-derive it from the durable source
  Asset (idempotent). Its size/duration are captured (ffprobe) into provenance.
- **D3 — "Primary Marketing Video" is a pointer table, not a mutable `assets.is_primary` column.**
  `assets` is immutable by design (the `AssetStore` port deliberately has no `update`). A mutable
  `is_primary` on the row would break that invariant. A `listing_primary_video (listing_id PK,
  asset_id)` pointer gives "max one primary per listing" via the PK and atomic promotion via one
  `upsert … on conflict (listing_id)`, without ever mutating an immutable Asset. (`property_photos`
  already has an unrelated `is_primary` — another reason to avoid the name on `assets`.) The F2-A/ADR
  doc mentioned `assets.is_primary`; this is the "mecanismo equivalente seguro" the gate §8 allows.

---

## 1. File map

### New modules (each with a colocated `*.test.ts`)

| File | Responsibility |
|---|---|
| `src/lib/video-engine/source-strategy.ts` | **Frozen internal contract** (§2): `SourceStrategy`, `RenderProfileId`, `SelectedSource`, `PreparedSource`, `PreparationPlan`, `CompositionInput` re-export; `selectSourceForStrategy()` dispatch. |
| `src/lib/video-engine/render-profiles.ts` | Render-profile registry. Ships `standard`; open for additive entries. Each: `{id,width,height,fps,videoCodec,audioCodec,compositionId,expectedQaSpec(input)}`. |
| `src/lib/video-engine/video-source-limits.ts` | Centralized MVP limits (§10) as one exported const + `reconcileWithInfra()` note. |
| `src/lib/video-engine/prepare-video.ts` | **Pure** FFmpeg layer: `buildNormalizeFfmpegArgs(sourceMeta, profile)` (blurred-fill for non-16:9, pad/scale/fps/pix_fmt, AAC when audio present) + `validateSourceMeta(ffprobeJson, limits)` → typed `VIDEO_*` errors. **No exec here** — returns opaque arg arrays. |
| `src/lib/video-engine/uploaded-video-source.ts` | `selectForStrategy("uploaded_video")`: locate the listing's seller-upload source video Asset, assert listing+owner, produce `SelectedSource`. Host-side auth/existence only (→ `VIDEO_SOURCE_MISSING`/`VIDEO_SOURCE_UNAUTHORIZED`). |
| `src/lib/assets/primary-video.ts` | `promotePrimaryVideo(store, listingId, assetId)` + `getPrimaryVideo(store, listingId)` over the pointer table. |
| `src/remotion/composition-input.ts` | Discriminated-union zod schema for `CompositionInput` (photo_slideshow \| uploaded_video). Generalizes today's `listingVideoInputSchema`. |
| Migrations (see §2 of "Migrations"): 3 files. | |

### Modified modules

| File | Change |
|---|---|
| `src/remotion/input.ts` | Re-express `listingVideoInputSchema` as the `photo_slideshow` arm of the union (shape-preserving for photos); keep all timing helpers unchanged. |
| `src/remotion/ListingVideo.tsx` → `ListingVideoComposition` | Generalize: same cards/lower-third/hairline/badge; body switches on `input.source`. `uploaded_video` body = `@remotion/media <Video disallowFallbackToOffthreadVideo>` playing the prepared 16:9 file via `resolveStagedSrc`. **Photo output byte-identical.** Composition `id` stays `"ListingVideo"`. |
| `src/remotion/Root.tsx` | `calculateMetadata` branches on discriminant (photo: `totalDurationFrames(photoCount)`; video: `opening + round(durationSec*fps) + closing`). Keep photo `defaultProps`. |
| `src/remotion/resolve.ts` | Rename `resolvePhotoSrc` → `resolveStagedSrc` (same logic; also used for `videoSrc`); keep a re-export alias so nothing else breaks. |
| `src/lib/video-engine/versions.ts` | Bump `INPUT_SCHEMA_VERSION` `"1"→"2"`; add `MEDIA_VIDEO_VERSION="4.0.489"`, `RENDER_PROFILE_DEFAULT="standard"`. `TEMPLATE_VERSION` stays `"2"` (photo visual output unchanged; source_strategy/render_profile now discriminate provenance + idempotency). |
| `src/lib/video-engine/produce-asset.ts` | Accept `{sourceStrategy, renderProfile, compositionInput, preparation}` instead of assuming photos. Replace `expectedSpecFor(photoCount)` with `renderProfile.expectedQaSpec(compositionInput)`. `compositionId` from the profile. `onStage` union gains `"validating" \| "preparing"`. Provenance gains `sourceStrategy`/`renderProfile`/prepared-source metrics. |
| `src/lib/video-engine/render-provider.ts` | Add, inside the one sandbox session: (a) `npm i @remotion/media@4.0.489 --no-save` (D1); (b) a generic **preparation phase** — when `RenderInput.preparation` is set: ffprobe the staged source → `validateSourceMeta` → run the opaque FFmpeg args → ffprobe the normalized file (provenance). `RenderInput` gains `preparation?: PreparationPlan`; `RenderMediaOutput` gains `sourceProbeJson`/`preparedProbeJson`/`prepareMs`. Fires `onStage("validating"/"preparing")` via injected hook. |
| `src/lib/video-engine/qa.ts` | Extend `ExpectedTechnicalSpec` with `audioExpected:boolean`, optional `audioCodec`, optional `aspect`. `parseFfprobe` adds: audio-codec check (**only when `audioExpected`**, so photo QA is unchanged), audio↔video duration coherence, aspect-ratio check. |
| `src/lib/video-engine/worker-deps.ts` | `buildRealProduce` dispatches on the job's `sourceStrategy`: photo path unchanged; `uploaded_video` path = select+validate source → build `PreparedSource` (download source, attach `PreparationPlan`) → `produceVideoAsset`. `downloadAsset` gains a "no downscale for video" branch. Load `sourceStrategy`/`renderProfile` from the job. |
| `src/lib/creative-jobs/states.ts` | Add `validating`, `preparing` states + edges (§ Job flow). Keep `running→rendering` legal so **photo jobs are unchanged**. |
| `src/lib/creative-jobs/errors.ts` | Add the 12 `VIDEO_*` codes + `ERROR_CLASS` mapping (§ Errors). |
| `src/lib/creative-jobs/jobs.ts` | `CreativeJob` + `CreateJobInput` gain `sourceStrategy`/`renderProfile` (mirror new columns; default photo_slideshow/standard). |
| `src/lib/creative-jobs/jobs-store.supabase.ts` | Map the two new columns. |
| `src/lib/assets/types.ts` | `AssetStore` gains `listByKind(listingId, kind)` + primary-pointer methods `getPrimaryVideo`/`setPrimaryVideo` (or a separate `PrimaryVideoStore` — see D3). Document `source_type` values (`seller_upload` for uploaded source video). |
| `src/lib/assets/asset-store.supabase.ts` | Implement the new store methods (pointer upsert + kind filter). |
| `src/lib/assets/asset-manager.ts` | Keep `selectForCapability` (photo). Add nothing strategy-specific here (strategy dispatch lives in video-engine); optionally a thin `selectSourceVideo(store, listingId)`. |
| `src/app/api/creative-studio/video/generate/route.ts` | Accept optional `source_strategy` (default `photo_slideshow`) + `render_profile` (default `standard`); thread both into the idempotency key + `createJob`. For `uploaded_video`, readiness = "a valid source video Asset exists" (not photo count). **Source upload endpoint is OUT of scope** — the route assumes the source Asset exists. |
| `src/app/api/creative-studio/video/status/route.ts` | Map the new `VIDEO_*` codes into the existing two-level (seller-safe vs technical) status buckets. |
| `src/lib/video-engine/idempotency.ts` | Fold `sourceStrategy`+`renderProfile` into `BuildIdempotencyKeyInput` (via the existing `inputHash` seam or as explicit fields). |

### Explicitly NOT touched (regression surface kept frozen)
`pipeline.ts` orchestration (only the `Stage`/`onStage` union widens), `manifest.ts`, `font-guard.ts`,
`storage-port.ts`, the Sandbox base artifact, the photo_slideshow visual output, all landing/marketing/
auth/seller-flow code.

---

## 2. Proposed migrations (authored; applied only after owner sign-off, per CLAUDE.md)

All idempotent (`if not exists` / additive `alter … add column if not exists`), forward-only, RLS-aware
(sellers read-only; service client writes).

**M1 — `creative_jobs`: strategy/profile + two new states**
```sql
alter table public.creative_jobs
  add column if not exists source_strategy text not null default 'photo_slideshow',
  add column if not exists render_profile  text not null default 'standard';
alter table public.creative_jobs
  add constraint creative_jobs_source_strategy_chk
    check (source_strategy in ('photo_slideshow','uploaded_video')) not valid;
alter table public.creative_jobs
  add constraint creative_jobs_render_profile_chk
    check (render_profile in ('standard')) not valid;
-- widen the state check to include the two new technical states
alter table public.creative_jobs drop constraint if exists creative_jobs_state_check;  -- (name TBD from baseline)
alter table public.creative_jobs
  add constraint creative_jobs_state_check
    check (state in ('queued','running','validating','preparing','rendering','uploading','qa','completed','failed','cancelled'));
```
*(`… not valid` avoids a full-table scan on add; validate separately. The exact current constraint name
is confirmed from the DB before writing the drop.)*

**M2 — Primary Marketing Video pointer (D3)**
```sql
create table if not exists public.listing_primary_video (
  listing_id uuid primary key references public.properties(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.listing_primary_video enable row level security;
create policy "primary_video owner select" on public.listing_primary_video
  for select using (owner_id = auth.uid());   -- writes via service client only
```
Atomic promotion: `insert … on conflict (listing_id) do update set asset_id=excluded.asset_id, updated_at=now()`.

**M3 — source-video selection index**
```sql
create index if not exists assets_listing_kind_source_idx
  on public.assets (listing_id, kind, source_type);
```

No storage/bucket migration: the prepared artifact is ephemeral (D2); the **source** upload bucket is an
owner action deferred with the upload endpoint (§ out-of-scope) — the plan notes the expected path
convention (`creative-studio/<owner>/<listing>/source/<assetId>.mp4`) but F3-A does not create it.

---

## 3. TypeScript contracts (the frozen internal contract — gate §2)

```ts
// src/lib/video-engine/source-strategy.ts
export type SourceStrategy = "photo_slideshow" | "uploaded_video";
export type RenderProfileId = "standard";

// Seam A — what a strategy resolved + authorized as its source.
export interface SelectedSource {
  strategy: SourceStrategy;
  sourceAssets: Asset[];            // photo Assets, or [the one seller-upload video Asset]
}

// Seam C — discriminated composition input (zod in src/remotion/composition-input.ts).
export type CompositionInput =
  | { source: "photo_slideshow"; property: {addressLine:string; name?:string};
      priceLabel: string; photos: {url:string; roomLabel?:string}[];
      brand: {name:string}; cta: {text:string}; badge: {text:string}|null }
  | { source: "uploaded_video"; property: {addressLine:string; name?:string};
      priceLabel: string; videoSrc: string; durationSec: number; hasAudio: boolean;
      brand: {name:string}; cta: {text:string}; badge: {text:string}|null };

// Seam B — ready to render; FFmpeg specifics do NOT cross this boundary.
export interface PreparationPlan {
  sourceRef: string;                // staged source filename, e.g. "source-0.mp4"
  normalizedRef: string;            // output the composition references, e.g. "prepared-0.mp4"
  ffmpegArgs: string[];             // OPAQUE — built by prepare-video.ts, exec'd by the provider
  limits: VideoSourceLimits;        // re-checked against the source's in-sandbox ffprobe
}
export interface PreparedSource {
  strategy: SourceStrategy;
  localSourcePaths: string[];       // host files staged into the bundle publicDir
  preparation: PreparationPlan | null;   // null for photo_slideshow (no normalization)
  compositionInput: CompositionInput;    // Seam C
}

// Seam D — render profile registry entry.
export interface RenderProfileSpec {
  id: RenderProfileId;
  width: 1920; height: 1080; fps: 30;
  videoCodec: "h264"; audioCodec: "aac";
  compositionId: "ListingVideo";
  expectedQaSpec(input: CompositionInput): ExpectedTechnicalSpec;  // qa.ts, now audio-aware
}

// Centralized limits — gate §10.
export interface VideoSourceLimits {
  maxDurationSec: 60; maxWidth: 3840; maxHeight: 2160; maxBytes: 314_572_800; // 300 MB
  container: "mp4"; videoCodec: "h264"; audioCodecs: ["aac"]; audioRequired: false; videoRequired: true;
}
```
Boundary guarantees: production code above the provider imports **none** of FFmpeg's or
`@remotion/media`'s internals — it only sees `PreparationPlan.ffmpegArgs` (opaque) and
`CompositionInput` (Remotion-agnostic). Only `render-provider.ts` (execs FFmpeg) and
`ListingVideoComposition` (imports `@remotion/media`) touch those internals — the "corresponding
layers" (gate §2).

---

## 4. Job flow

**photo_slideshow (unchanged):** `queued → running → rendering → qa → uploading → completed`. Same
transitions, same output, same idempotency (now also keyed by `source_strategy='photo_slideshow'`,
which is the default — existing keys' meaning is preserved because the default matches prior implicit
behavior; note this in the idempotency test).

**uploaded_video (new):**
```
generate route: {source_strategy:'uploaded_video', render_profile:'standard'} → createJob(queued)
worker: claimNextQueued → running
 ├─ validating (host):   selectForStrategy('uploaded_video') → assert listing+owner+exists
 │                       → VIDEO_SOURCE_MISSING / VIDEO_SOURCE_UNAUTHORIZED
 ├─ [open sandbox once]  install @remotion/media; stage downloaded source
 ├─ validating (sandbox) ffprobe source → validateSourceMeta →
 │                       VIDEO_CONTAINER_UNSUPPORTED / VIDEO_CODEC_UNSUPPORTED /
 │                       VIDEO_STREAM_MISSING / VIDEO_DURATION_EXCEEDED /
 │                       VIDEO_RESOLUTION_EXCEEDED / VIDEO_FILE_TOO_LARGE / VIDEO_CORRUPT
 ├─ preparing            ffmpeg normalize → 16:9 h264/aac prepared file (+ ffprobe it) → VIDEO_PREPARATION_FAILED
 ├─ rendering            bundle → selectComposition('ListingVideo', uploaded_video input) → renderMedia h264 → VIDEO_RENDER_FAILED
 ├─ qa                   parse in-sandbox ffprobe of OUTPUT (incl. audio + aspect + a/v coherence) → VIDEO_QA_FAILED
 ├─ uploading            checksum → upload (creative-studio bucket) → read-verify → createAsset(kind=video, source_type=generated, provenance)
 └─ completed
```
The sandbox opens once and does validate-source → prepare → render → QA before `stop()`. Cancellation
edges: `running/validating/preparing/rendering → cancelled` legal; `qa/uploading` finish (mirrors the
existing "finish a near-done upload" rule). Primary-video promotion is **explicit** (a separate call),
never automatic on completion.

---

## 5. Test changes

TDD, red→green, no real Sandbox/DB in unit tests (repo rule; fakes only).

- **New:** `source-strategy.test.ts`, `render-profiles.test.ts`, `prepare-video.test.ts` (ffmpeg-arg
  shape + every `validateSourceMeta` reject path → correct `VIDEO_*` code; blurred-fill args only for
  non-16:9; passthrough for 16:9), `video-source-limits.test.ts` (+ infra-reconciliation assertions),
  `uploaded-video-source.test.ts` (missing/unauthorized/happy), `primary-video.test.ts` (max-one +
  atomic promotion + re-promotion), `composition-input.test.ts` (union accept/reject).
- **Extended:** `qa.test.ts` (audio-expected checks; **photo path still passes with `audioExpected:false`**;
  aspect + a/v coherence), `produce-asset.test.ts` (generic strategy path + module-isolation list
  updated for new files; `expectedSpecFor` → profile-driven), `render-provider.staging.test.ts`
  (source staging + preparation-phase file layout, still no real sandbox), `worker-deps.test.ts`
  (uploaded_video produce path with fakes; downloadAsset no-downscale branch), `states.test.ts`
  (new states + legality; photo path intact), `errors.test.ts` (new codes + classification),
  `jobs.test.ts`/`jobs-store` (new columns default correctly), `idempotency.test.ts`
  (strategy/profile change the key; default preserves photo keys), `generate/route.test.ts`
  (strategy param threading; uploaded_video readiness).
- **Contract tests (gate §13):** a dedicated `pipeline-contract.test.ts` proving: slideshow still
  selects photos; uploaded_video selects a prepared video; each strategy yields the correct
  `CompositionInput` arm; each profile yields a valid `ExpectedTechnicalSpec`; **a new strategy needs
  no new composition** (both arms drive `id:"ListingVideo"`); **a new profile needs no new strategy**
  (profile registry is independent of the strategy dispatch).
- **Regression guard:** a golden test asserting `photo_slideshow` `CompositionInput` + duration +
  `expectedQaSpec` are byte-identical to today's `listingVideoInputSchema`/`totalDurationFrames`/
  `expectedSpecFor` outputs.

Quality gates (CLAUDE.md): `tsc --noEmit`, `lint`, `test`, `migrations:check`, `build` all green before
any commit; the real-sandbox uploaded_video render is a **controller-driven** validation pass (like
prior gates), separate from the unit slice, seeding a source video Asset directly.

---

## 6. Risks

1. **`@remotion/media` in-sandbox install (D1)** — a ~1 s per-render `npm i` re-enters the pattern the
   prebuilt base exists to avoid, and depends on npm registry reachability from the sandbox. *Mitigation:*
   pin exact version, `--no-save`, fail the render loudly if it errors (`VIDEO_PREPARATION_FAILED` bucket);
   file the "bake it into the next artifact" follow-up. **Confirm acceptable.**
2. **State-machine + migration change** — adding `validating`/`preparing` touches the most heavily-tested
   core (`states.ts`) and a check-constraint migration. *Mitigation:* keep `running→rendering` legal so
   photo is untouched; golden/contract tests; `not valid` constraint add.
3. **Worker/sandbox timeouts vs 60 s render** — a 60 s source render is ~3–4 min (F2-D). Sandbox
   `timeoutMs` default is 5 min and the worker function's `maxDuration` must exceed the render.
   *Mitigation:* raise `timeoutMs` to ~480 s for uploaded_video and set the worker route `maxDuration`
   (~800 s Fluid) and `jobTimeoutMs` accordingly; the **60 s cap is the load-bearing bound**. Confirm the
   Vercel plan's max function duration covers it.
4. **Source ingestion is out of scope but selection needs a source** — F3-A assumes a seller-upload video
   Asset exists; without the upload endpoint the path is only exercisable via seeded tests + a manual
   controller run. *Mitigation:* explicit assumption + defined path convention; the upload endpoint is
   the very next gate.
5. **Memory on 4 K input** — decoding 4 K before downscale raises peak memory (F2-D vertical hit ~5.6 GB
   at 30 s under 8.6 GB). A 4 K × 60 s could approach the cap. *Mitigation:* normalize downscales early;
   consider a first-pass scale filter before heavy work; keep 4 K as the *max* and watch peak-mem
   provenance; lower the cap if it proves tight.
6. **Idempotency-key meaning shift** — adding strategy/profile to the key. *Mitigation:* default values
   reproduce existing photo keys exactly (test-asserted); no existing active job is orphaned.
7. **Two `is_primary` concepts** — `property_photos.is_primary` (existing) vs Primary Marketing Video.
   *Mitigation:* D3's pointer table avoids the name entirely on `assets`.

---

## 7. Implementation sequence (small, independently-green steps)

1. **Contracts + limits (no behavior):** `source-strategy.ts`, `render-profiles.ts`,
   `video-source-limits.ts`, `composition-input.ts` + tests. `tsc` green.
2. **Pure FFmpeg layer:** `prepare-video.ts` (args + `validateSourceMeta` + `VIDEO_*` errors) + tests.
3. **Errors + states:** extend `errors.ts`, `states.ts` (+ migration M1 authored) + tests. Photo golden
   test stays green.
4. **QA extension:** audio-aware `qa.ts` + tests (photo path unchanged).
5. **Composition generalization:** `input.ts`/`composition-input.ts`, `ListingVideoComposition`,
   `Root.tsx`, `resolve.ts`; add `@remotion/media@4.0.489` to `package.json`. Photo render golden test
   byte-identical.
6. **Provider preparation phase:** `render-provider.ts` (install + validate + normalize + probes),
   `RenderInput`/`RenderMediaOutput` extensions + staging tests.
7. **produce-asset generalization:** strategy/profile/prepared-source + provenance/metrics + `onStage`
   union + tests.
8. **Primary-video:** M2 migration + `primary-video.ts` + store methods + tests.
9. **Worker wiring:** `worker-deps.ts` uploaded_video produce path; job columns (`jobs.ts`, store, M1
   already authored) + tests.
10. **Route + status + idempotency:** `generate` params, `status` code mapping, `idempotency.ts` + tests.
11. **Contract + regression suite (§13)** green; full quality gates (`tsc/lint/test/migrations:check/build`).
12. **Controller-driven real-sandbox validation** (seeded source Asset) — separate, not part of the unit
    slice; documented like prior gates.

Migrations M1–M3 are **authored** in steps 3/8/9 but **applied only after explicit owner sign-off**
(CLAUDE.md — never `supabase db push` without it).

---

## 8. Rollback criteria

- **Code:** all F3-A code is additive behind `source_strategy`. `photo_slideshow` is the default and
  its output/tests are golden-locked, so reverting the branch (or leaving `uploaded_video` unreachable)
  restores exact prior behavior. The `generate` route defaults to `photo_slideshow`, so even a
  half-deployed state never changes existing behavior.
- **Feature exposure:** `uploaded_video` is only reachable by explicitly passing `source_strategy`;
  with no UI (out of scope) it is dormant until a later gate wires it. `CREATIVE_STUDIO_VIDEO_ENABLED`
  still gates the whole route.
- **Migrations:** M1 columns are defaulted + additive (no data loss on down); the state-check widening
  is backward-compatible (old states remain valid). M2/M3 are new-object-only. Rollback = drop the new
  table/index/columns; no existing row is rewritten. Because migrations apply only after sign-off,
  code can ship and be reverted with **no** DB change if desired.
- **Trigger to roll back:** any failure of the photo golden/contract tests, the real-sandbox photo
  render regressing, or the uploaded_video real render failing QA on the current snapshot → revert the
  branch; investigate before re-attempting. No production/preview/deploy happens in this gate.

---

## 9. Out of scope (restated)

Upload UI/drag-drop/progress, primary selection UI, i18n, reels/social/luxury/drone/AI strategies,
MOV/HEVC, thumbnails, trimming/editing/music/captions/concatenation, Production, Preview, deploy, merge,
re-bake, and the **source-video upload endpoint** (F3-A consumes an assumed source Asset).

**STOP.** Awaiting authorization to execute step 1.

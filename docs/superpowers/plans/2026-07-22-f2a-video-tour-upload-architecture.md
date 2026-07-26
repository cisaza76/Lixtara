# F2-A — Property Video Pipeline: Architecture & Design
### (first strategy: Uploaded Video)

**Design only — 2026-07-22.** No code, no migrations, no buckets, no env vars, no infra, no
PR/deploy, no Preview/Production changes. This document specifies a **generic Property Video
Pipeline** — one pipeline that produces a branded listing video from any of several **source
strategies** — and designs **Uploaded Video** as its first new strategy. It **reuses the Creative
Studio v1 pipeline as-is wherever possible.** See `docs/adr/0001-generic-property-video-pipeline.md`
for why a single generic pipeline (not N specialized compositions).

## Conceptual model — one pipeline, TWO orthogonal axes

The product is "a branded Lixtara listing video." Two **independent** questions define any video —
kept separate on purpose, because conflating them is the mistake that forces specialized pipelines:

**Axis 1 — Source Strategy: *where the body content comes from.***

| Source Strategy | Body source | Status |
|---|---|---|
| `photo_slideshow` | the seller's `property_photos` (Ken-Burns + crossfades) | **shipped in v1** — retrofit under the generic pipeline |
| `uploaded_video` | one owner-uploaded phone clip | **this document (first new source)** |
| `drone_video` | an uploaded/linked aerial clip | future |
| `future_ai` | AI-generated footage | future |

**Axis 2 — Render Profile: *what output objective / format / styling the render targets.***

| Render Profile | Dimensions | Intent | Status |
|---|---|---|---|
| `standard` | 1920×1080 (16:9) | the default marketing video | **MVP** |
| `luxury` | 1920×1080 | premium styling/pacing tokens | future |
| `social_vertical` / `reel` | 1080×1920 (9:16) | Instagram/TikTok/Reels | future |
| `square` | 1080×1080 | feed posts | future |
| `mls` | 1920×1080, MLS-compliant constraints | portal syndication | future |

They are **orthogonal**: `uploaded_video → reel`, `uploaded_video → social_vertical`, and
`photo_slideshow → luxury` are all valid combinations produced by the **same** composition and
pipeline. Source Strategy answers "what footage?"; Render Profile answers "for what and in what
shape?".

**The pipeline:**

```
  Source Strategy ──▶ ListingVideoComposition ──▶ Render Profile ──▶ Asset
   (what content)        (shared Lixtara frame)     (dims/format/style)   (one of many per listing)
```

- **One generic composition — `ListingVideoComposition`** — renders the shared Lixtara frame
  (OpeningCard(address) → **body(sourceStrategy)** → ClosingCard(CTA) + shared lower-third,
  watermark, gold motif, system fonts). The **body** is chosen by Source Strategy; the **output
  dimensions / aspect / styling tokens** come from the Render Profile (via Remotion
  `calculateMetadata`, so one composition emits 16:9, 9:16, 1:1, … without a second composition).
  The brand is defined once.
- **One pipeline** (job → worker → sandbox render → QA → upload → Asset → listing) is axis-agnostic
  from "Create Job" down. A new Source Strategy = add a source selector + a body renderer; a new
  Render Profile = add a profile config (dims/style) — **never a new pipeline or composition.**
- v1's `ListingVideo` becomes the `photo_slideshow` body at the `standard` profile (a bounded
  refactor, §3), not a parallel composition.
- **A listing may hold many video Assets** (e.g. standard + vertical + a Spanish cut); exactly one is
  the **Primary Marketing Video** (§2).

> **Design guardrail (non-negotiable, applies to the MVP):** the MVP exercises only the simplest
> path — `uploaded_video` source × `standard` profile × one Primary video. This is NOT a video
> editor: the owner uploads ONE clip; the pipeline wraps it in the existing Lixtara frame (brand
> intro → the clip, normalized + a discreet lower-third + watermark → brand closing) and produces
> one elegant MP4. No timeline, no clip selection, no effects UI. The two-axis model + multiple
> outputs + profiles are the ARCHITECTURE (open for growth), not MVP scope.

---

## 1. End-to-end architecture

```
 Owner (mobile/desktop)
        │  1. request signed UPLOAD url (route: POST /video/tour/upload-url)
        ▼
 [property-tours-src bucket]  ── 2. browser uploads the clip DIRECTLY to Storage (signed, one-time)
        │  3. notify server (POST /video/tour/prepare) with the object path
        ▼
 VALIDATION  ── ffprobe the INPUT (container/codec/duration/fps/res/orientation/size)  ── reject → user message
        │  (on pass) wrap the uploaded object as a source Asset  kind=video, source_type=uploaded_video
        ▼
 CREATE JOB  ── creative_jobs, capability="video", source_strategy="uploaded_video",
        │  render_profile="standard"   (SAME table + state machine)
        │  queued
        ▼
 WORKER  (SAME route /video/worker, Bearer CRON_SECRET, one-job claim)
        │  running → rendering
        ▼
 RENDER  (SAME SandboxRemotionProvider + font guard + system fonts)
        │  dispatch: select source by source_strategy (uploaded_video → the clip); render the GENERIC
        │  composition "ListingVideoComposition" = OpeningCard → BODY(source_strategy) → ClosingCard
        │  (+ shared lower-third + watermark). Output dims/fps/styling from render_profile
        │  (standard → 1920×1080/30fps h264). body = <OffthreadVideo> for uploaded_video.
        ▼
 QA  (SAME in-sandbox ffprobe on the OUTPUT vs the render_profile's expected spec)  ── fail → job failed
        │  qa → uploading
        ▼
 UPLOAD  (SAME storage-adapter: creative-studio bucket + read-verify)
        │  uploading → completed
        ▼
 ASSET  video Asset  kind=video, provenance.templateId="ListingVideoComposition",
        │  provenance.sourceStrategy + provenance.renderProfile, parent_asset=source clip, listing_id;
        │  becomes the listing's Primary Marketing Video (first video, or on user "Set as primary")
        ▼
 LISTING  shown in the ListingVideoPanel (same review UI: Preview / Download)
```

**The only genuinely new boxes are the top two (Upload + Validation) and the `uploaded_video`
BODY of the generic composition.** Everything from "CREATE JOB" down is the v1 pipeline with a
**strategy dispatch** at two seams — no new pipeline, no new composition.

---

## 2. Data model

**No new tables.** Reuse `assets` + `creative_jobs`; add TWO discriminator columns + one primary flag.

| Entity | How | New? |
|---|---|---|
| **Job (any combination)** | `creative_jobs` row: `capability='video'` (unchanged — the *product* is a listing video), **`source_strategy`** ∈ {`photo_slideshow`,`uploaded_video`,…}, **`render_profile`** ∈ {`standard`,`social_vertical`,…}. | **new columns `source_strategy text` + `render_profile text`** (additive migration; defaults `photo_slideshow` / `standard` for existing rows) |
| **Uploaded source video** | `assets` row: `kind='video'`, `source_type='uploaded_video'`, `storage_bucket='property-tours-src'`, `storage_path`, `mime`, `bytes`, `checksum`, `qa` (the input-ffprobe result), `listing_id`, `owner_id`. | new `source_type` value + a validation payload in `qa` |
| **Output video (any combination)** | `assets` row: `kind='video'`, `provenance.templateId='ListingVideoComposition'`, **`provenance.sourceStrategy` + `provenance.renderProfile`**, `parent_asset` = the source (the uploaded clip for `uploaded_video`; null for `photo_slideshow`), `storage_bucket='creative-studio'`, `listing_id`, **`is_primary boolean`**. | reuses the v1 Asset shape + both axes in provenance + a primary flag |

- **Both axes live on the job** (the render dispatch keys) and are **stamped into the output's
  provenance** ("which source × which profile produced this?"). `capability` stays `'video'` — no
  per-combination sprawl. `source_strategy` and `render_profile` are **independent**.
- **Multiple videos per listing, exactly one Primary Marketing Video.** Add `assets.is_primary`
  guarded by a **partial unique index** `unique (listing_id) where kind='video' and is_primary`, so
  a listing can hold `standard` + `social_vertical` + an ES cut + a short reel while exactly one is
  the primary shown/syndicated. The first successful video is primary by default; the user can
  "Set as primary" later. (No new table; the listing points at the primary via the flag, or
  optionally a `properties.primary_video_asset_id` FK if a direct pointer reads cleaner.)
- **kind:** the output is `kind='video'` for all combinations. Do **not** reuse `kind='tour'` —
  that's the KIRI 3D/gaussian tours; keep them distinct.
- **One generic composition, versioned once:** `templateId='ListingVideoComposition'` with a single
  `TEMPLATE_VERSION` (the current photo template's history continues) + one `INPUT_SCHEMA_VERSION`.
  `inputProps` = **discriminated union on `sourceStrategy`** for the body
  (`{sourceStrategy:'photo_slideshow', photos}` | `{sourceStrategy:'uploaded_video', video:{url}}` | …)
  **+ a `renderProfile` object** (dimensions/fps/aspect/style tokens) driving Remotion
  `calculateMetadata` and framing — sharing the brand fields (address, price, brand, cta).
  `RENDERER_VERSION`/`BASE_ARTIFACT_VERSION` unchanged — **no re-bake** (OffthreadVideo needs only
  the baked ffmpeg; no new fonts). *(Confirm in the §10 spike.)*
- **Listing relationship:** source + output carry `listing_id`; `parent_asset` links output→source;
  regenerating produces a new Asset (history preserved), and the primary flag is moved, not the row.
- **Readiness is keyed by `source_strategy`** (a small registry): `photo_slideshow` → ≥1 usable
  interior photo; `uploaded_video` → exactly one `uploaded_video` source Asset that passed input
  validation. Both also require the listing approved. `render_profile` never affects readiness (it's
  purely an output concern). The generate route picks the readiness check by `source_strategy`.

---

## 3. Pipeline: reuse / change / new

**Reused unchanged (the bulk):** job state machine + transitions + traceId; worker route +
`CRON_SECRET`; `SandboxRemotionProvider` + font guard + system fonts + the immutable artifact;
`produceVideoAsset` → QA (`parseFfprobe`) → storage upload + read-verify; Asset model + provenance +
signed URLs; idempotency; `ListingVideoPanel` review UI; error-code/retry classification.

**Changed — the three seams (this is the whole generalization; the frozen internal API of §10):**
- **Seam A — source selection (by `source_strategy`):** `selectSourceForStrategy(sourceStrategy,
  assets, listingId)` (generalizes today's `selectForCapability`): `photo_slideshow` → kind=photo
  assets; `uploaded_video` → the one `uploaded_video` asset. New sources register a selector here.
- **Seam B — body rendering (by `source_strategy`):** `ListingVideoComposition` switches its BODY on
  `inputProps.sourceStrategy` (photo Ken-Burns gallery vs `<OffthreadVideo>`), keeping
  OpeningCard/ClosingCard/lower-third/watermark shared. New sources add a body renderer here.
- **Seam C — output configuration (by `render_profile`):** a profile registry maps `render_profile`
  → `{ width, height, fps, safeAreas, styleTokens, expectedQaSpec }`, consumed by Remotion
  `calculateMetadata` (dimensions/fps), the composition's framing, and QA's expected spec. New
  profiles register a config here — no composition change.
- `buildRealProduce` reads `job.source_strategy` + `job.render_profile`, downloads the source, and
  builds the `inputProps` (body union + `renderProfile`).
- Generate route selects the readiness check by `source_strategy` (§2); QA's expected spec comes
  from the `render_profile`.
- **Bounded retrofit:** the existing `src/remotion/ListingVideo.tsx` becomes the `photo_slideshow`
  body inside `ListingVideoComposition` at the `standard` profile (move, not rewrite — the current
  KenBurns/crossfade logic is unchanged; it becomes one branch). Behavior-preserving; ships first.

**Migrations (additive, small):** add `creative_jobs.source_strategy text` (default
`photo_slideshow`) + `creative_jobs.render_profile text` (default `standard`); add
`assets.is_primary boolean` with the partial unique index (§2). No capability-constraint change
(capability stays `video`).

**Completely new (all specific to the `uploaded_video` strategy):**
- `POST /api/creative-studio/video/upload-url` (mint a signed, one-time upload URL, owner-scoped).
- `POST /api/creative-studio/video/prepare` (ffprobe-validate the uploaded object → create the
  `uploaded_video` source Asset → readiness → createJob with `strategy='uploaded_video'`).
- `property-tours-src` private input bucket + its RLS.
- The `uploaded_video` BODY in `ListingVideoComposition` (`<OffthreadVideo>` + orientation handling).
- The `uploaded_video` branch of the `inputProps` union + its input-validation module (§4).
- Upload UI (dropzone + states) in `ListingVideoPanel`.

---

## 4. Input video validation (fail fast, user-facing)

Run ffprobe **on the uploaded input** (a new step; v1 only ffprobes the output) before creating a job.

| Property | Accept | Normalize to (output) | Reject message (example) |
|---|---|---|---|
| Container | `.mp4`, `.mov`, `.webm` | — | "Please upload an MP4 or MOV video." |
| Codec (video) | h264, hevc/h265 | h264 (re-encoded) | "This video format isn't supported — export as MP4 (H.264)." |
| Codec (audio) | aac / none | see §8 audio decision | — |
| Resolution | 720p–4K | fit within 1920×1080 | "Video resolution is too low — record at 720p or higher." |
| **Duration** | 5 s – **90 s** | capped | "Your video is 3:20 — please upload under 90 seconds so the tour stays crisp." |
| FPS | 24–60 | 30 | "Unusual frame rate — try recording at 30 fps." |
| Orientation | portrait or landscape | 1920×1080 landscape (portrait → **blurred-fill cover**, §8) | — (handled, not rejected) |
| Bitrate | ≤ ~50 Mbps | re-encoded | "Video bitrate is unusually high — please re-export." |
| File size | ≤ **500 MB** | — | "File is over 500 MB — please trim or re-export a smaller file." |
| Integrity | ffprobe parses a valid video stream | — | "This file looks corrupted or isn't a video." |

All limits are single constants so they're trivially tunable. Messages are friendly + specific and
say what to do next.

---

## 5. UX (all states, desktop + mobile)

Entry: the existing `ListingVideoPanel` gains a **"Upload a walkthrough"** option next to
"Create from photos". One clean dropzone/file-picker. **Mobile is the primary case** (phone video).

```
idle ──"Upload a walkthrough"──▶ selecting file
   │                                   │
   ▼                                   ▼
 uploading ██░░ 62%   ◀── direct-to-Storage (signed url), cancelable (abort)
   │
   ▼
 validating…  ── ffprobe input ──▶ (invalid) → error + "choose another file" (retry)
   │ (valid)
   ▼
 creating your tour…  (queued → running → rendering; poll /status; cancelable → job cancel)
   │
   ▼
 ready ▶ [ Preview ] [ Download ] [ Replace video ]   |   failed → reason + [ Try again ]
```

- **Desktop:** drag-drop or file picker; progress bar; live status; Preview modal + Download.
- **Mobile:** native file/camera-roll picker; same states; large touch targets; background-safe
  polling (the panel already polls `/status`).
- **Errors:** per stage — upload failed (network) → resume/retry; validation failed → specific §4
  message + pick another; render failed → `Try again` on retriable codes.
- **Retries:** re-upload (new file) or re-render (same source) — the job model already classifies
  retriable vs non-retriable.
- **Cancellation:** cancel the upload (AbortController); cancel a queued/running job
  (`cancellation_requested` — the supervisor already honors it).
- **One tour per listing:** "Replace video" supersedes; the panel shows the current tour.

---

## 6. Security

| Control | Design |
|---|---|
| Input bucket | new `property-tours-src`, **private**. Output stays in the existing private `creative-studio`. |
| Upload path | **signed, one-time upload URL** (Supabase `createSignedUploadUrl`) so the browser uploads directly — the service key is never exposed and large files never proxy through the function. |
| RLS | uploads WITH CHECK `(storage.foldername(name))[1] = auth.uid()` (own-folder only); reads owner-scoped; brokers/admin via `is_admin_or_broker()` (same pattern F1-O established). |
| MIME | client `content-type` allow-list at upload **AND** ffprobe re-validation server-side (never trust the client MIME). |
| Signed READ URLs | short TTL (120–300 s), per-request, never persisted (same as v1). The raw input is **never served publicly**. |
| Size / duration limits | bucket + route enforce max size; ffprobe enforces max duration/bitrate (§4). |
| Rate limiting / abuse | per-user upload cap (e.g. 3/day) + the existing `/generate` limiter; owner-only (must own the listing). |
| Isolation | render runs in the disposable Vercel Sandbox (already isolated); a malicious file can't touch app infra. |
| Virus / malware scanning | **MVP:** ffprobe-gate (rejects non-video) + sandbox isolation + size caps + never public. **Residual risk:** a valid-but-malicious media file. **v1.1:** add an AV scan (ClamAV or a hosted scanner) and/or content **moderation** (a video could contain inappropriate footage) as its own gate. Flagged as a known deferral, not an oversight. |
| ffprobe | now runs on **input** (validation) AND **output** (QA). |

The dominant new attack surface is the upload/ingest path; it is designed fail-closed and
owner-scoped, with AV/moderation explicitly deferred to v1.1 (see risks).

---

## 7. Performance

- **Upload:** direct-to-Storage; bounded by the user's file size + connection (a 60–90 s phone clip
  ≈ 50–200 MB). Progress UI; (v1.1) resumable/multipart for flaky mobile networks.
- **Render (the key unknown):** `<OffthreadVideo>` decodes the input frame-by-frame and re-encodes
  to h264 — **heavier than the photo slideshow** (which composites stills). Expect render time to
  scale with output duration; a 90 s tour on the 4-vCPU sandbox could plausibly take **several
  minutes**. OffthreadVideo streams frames (bounded memory), which is good, but this must be
  **measured in the §10 spike**, not assumed.
- **Consumption:** same 4-vCPU/8-GB sandbox; input download + decode + re-encode.
- **Limits:** max output duration 90 s (bounds cost), one job per listing, worker `timeoutMs`
  (already 600 s; may need raising for long clips — a spike output).
- **Scalability:** same claim-one-job worker; horizontal by running the worker more often / in
  parallel (the atomic `claimNextQueued` already supports concurrent workers). Cost per tour is a
  bounded sandbox-minute figure once the spike measures it.

---

## 8. Risks

| # | Risk | Prob | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Portrait phone video** vs 1920×1080 landscape output | High | Med | MVP: blurred-fill cover (video centered, blurred copy behind); offer a native 9:16 output preset in v1.1. |
| R2 | **Render time/cost** for video re-encode unknown/too high | Med | High | Bound duration to 90 s; **measure in the spike first**; raise sandbox vCPUs or worker timeout only if needed. |
| R3 | **Malicious / inappropriate** uploads | Med | High | ffprobe-gate + sandbox isolation + size caps + never public (MVP); AV scan + content moderation as a v1.1 gate. |
| R4 | **Codec/rotation variety** (hevc, rotation metadata, VFR) | High | Med | ffprobe-detect; ffmpeg handles rotation/hevc/VFR on re-encode; reject exotic; normalize to h264/30fps. |
| R5 | **Audio handling** ambiguity (keep the walkthrough narration vs mute + music) | High | Med | **Product decision (recommend: keep original audio in MVP** — a walkthrough is the agent talking; music-over is a v1 toggle). |
| R6 | Large/slow uploads on mobile fail | Med | Med | Progress + retry (MVP); resumable upload (v1.1). |
| R7 | Artifact incompatibility (OffthreadVideo needs something not baked) | Low | High | **Spike proves it in the current snapshot before any build** — no re-bake expected (ffmpeg is baked). |
| R8 | Capability/migration + readiness regressions on the shared `creative_jobs`/`assets` path | Low | Med | Small, additive migration (widen check constraint); the capability branch is at a clean seam; integration tests (F1-R D-P0-1). |
| R9 | Cost blow-up from abuse (many long renders) | Med | Med | Upload rate cap + duration cap + one-job-per-listing + owner-only. |

---

## 9. Roadmap

- **MVP** — Upload one clip → validate (§4) → wrap in the Lixtara frame (brand intro with address →
  the normalized clip + discreet lower-third(price)+watermark → brand closing) → 1920×1080 h264
  tour → Preview/Download. Portrait = blurred-fill. **Keep the original audio.** No trimming, no
  effects, no editing.
- **v1** — auto-trim to a sensible max / simple 2-handle start–end; original-audio ↔ music toggle;
  "Replace video"/regenerate; polish the states.
- **v1.1** — AV scan + content moderation gate; resumable/multipart upload; native **9:16 vertical**
  output preset (for Reels/social).
- **v2** — AI enhancement (stabilization / color / upscale); auto-highlight (pick the best segments);
  multi-clip stitch. Heaviest new infra — last.

---

## 10. Recommendation — "If I were Lixtara's CTO"

**Build order:**

1. **A throwaway spike FIRST (de-risk the two unknowns, F1-style).** In the *current* base
   snapshot, render a real phone clip through `<OffthreadVideo>` wrapped by minimal brand cards,
   and ffprobe-validate a handful of real phone inputs (mp4/h264, mov/hevc, portrait, 4K, VFR).
   **Answer exactly two questions before building anything:** (a) does the current artifact render
   OffthreadVideo with no re-bake? (b) how long does a 90 s clip take, and does it fit the worker
   timeout/memory? This mirrors the font-isolation experiment that saved us weeks. **~2–3 d.**

2. **Generalize the pipeline (behavior-preserving).** Introduce the three seams with **zero
   user-visible change**: add `creative_jobs.source_strategy` + `render_profile` + `assets.is_primary`;
   generalize `selectForCapability`→`selectSourceForStrategy`; add the render-profile registry
   (`standard` only, = today's 16:9); and move today's `ListingVideo` into the `photo_slideshow` body
   of `ListingVideoComposition`. Re-run F1's validation to prove the photo path is byte-for-byte
   equivalent.

3. **Freeze the internal API (the contract, before the feature).** Lock the stable interfaces
   between **Source Strategy ↔ Composition ↔ Render Profile** — the exact shapes of
   `selectSourceForStrategy`, the `inputProps` discriminated union + `renderProfile` object, the
   profile registry entry, and the readiness registry — and write them down (+ types + a couple of
   contract tests). A good frozen contract is what makes every future strategy/profile a small
   additive change; a leaky one forces rework later. **This is the highest-leverage step.**

4. **Add `uploaded_video` (the first new source) at the `standard` profile.** Input bucket + RLS +
   signed upload URL; the ffprobe input-validation module; the `uploaded_video` readiness + body
   (`<OffthreadVideo>` reusing the shared OpeningCard/ClosingCard/LowerThird/watermark). Everything
   else (worker, QA, storage, Asset, signed URL, guard, fonts) is reused verbatim. Validate E2E on a
   real listing exactly as F1-O/P did — the first real exercise of the frozen contract.

5. **UI last.** The dropzone + states in `ListingVideoPanel` — small, once the backend is proven.

**What I'd do first:** the spike, then the generic retrofit, then **freeze the contract**, then the
`uploaded_video` body + input validation (the real substance). **What I'd defer:** trimming,
resumable upload, music library, additional render profiles (vertical/reel/luxury/mls), multiple
outputs UX, and every source beyond `uploaded_video`. **What I would NOT build yet:** any editing
UI/timeline, effects, AI enhancement, multi-clip — they violate the "upload → magic → elegant tour"
guardrail and add disproportionate cost/risk. **Note:** the architecture *supports* profiles and
multiple outputs from day one (§2/§3); the MVP simply doesn't *exercise* them.

**Sequencing vs F1-R debt:** land the F1-R **P0** items (route/integration tests, the Preview-worker
decision, Sentry) alongside or just before this MVP — the tour path rides the same worker/pipeline
and inherits those gaps.

**The whole MVP in one sentence:** *the owner uploads one phone clip, ffprobe says "yes this is a
usable video," and the existing render pipeline wraps it in the Lixtara frame and hands back an
elegant MP4 — no editor, no knobs, nothing else.*

---

Design only. Nothing implemented; no infra, migrations, buckets, vars, PR, deploy, Preview, or
Production changes. Stop here.

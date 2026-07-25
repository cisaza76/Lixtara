# Creative Studio P2 — first real deliverable: a deterministic listing video

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** From a real listing's real photos, produce **one deterministic MP4** (no generative
AI) through the Video Engine's Remotion renderer running on **Vercel Sandbox**, store it in
**Supabase Storage** as an **immutable, versioned Asset** with full provenance/cost, run it
through an async **Creative Job** with per-transition telemetry (DB + Sentry), and surface it
in **Edit Listing / Creative Studio** (NOT onboarding Step 5) as a reviewable, manually
downloadable preview.

**Architecture:** A flag-gated Vercel function **enqueues** a Creative Job and returns **202 +
jobId** — it never renders in-request. A **decoupled durable worker** (secure Vercel Cron) claims
the job atomically, generates signed URLs and **downloads the photos into a prebuilt, pinned-
version Vercel Sandbox**, renders deterministically via Remotion (**bundle cached per template
version**, then `selectComposition` → `renderMedia`, codec h264), runs **ffprobe technical QA**,
uploads the MP4 to Supabase Storage, and only then creates an immutable, versioned `kind:"video"`
Asset (`lifecycle: ready_for_review`) with full provenance + checksum. Every transition is logged;
cancellation/timeout/heartbeat-recovery/idempotency are first-class. The render target sits behind
a `RenderProvider` adapter (Lambda is the ratified escape hatch). **A mandatory Spike P2.0 proves
the Sandbox render before the pipeline is built.** The LLM is not involved in P2.

**Tech Stack:** TypeScript (strict), Vitest, Next.js 16 App Router, Supabase (Postgres +
Storage + RLS), `@remotion/bundler` + `@remotion/renderer` + `remotion` (React 19 compositions),
`@vercel/sandbox`, `@sentry/nextjs`.

## Global Constraints (from the ratified decisions — every task inherits these)

- **Render target:** Vercel Sandbox (ADR-0001, ACCEPTED). Remotion Lambda stays an adapter
  escape hatch — do NOT build it. Behind a `RenderProvider` interface.
- **Build for Vercel Pro** (5 h / 2000 concurrency). Degrade gracefully in dev/CI: lower
  resolution, single concurrency, short fixtures, and a way to **skip the heavy render in CI**
  (the render adapter is never invoked by unit tests — it's behind an interface that tests mock).
- **Storage = Supabase Storage, single source of truth** (source photos AND the render). No
  Vercel Blob. Sandbox temp disk is transient; the MP4 must be uploaded to Supabase and its
  Asset row created **before the job is `completed`**, then the temp file deleted.
- **Assets are immutable + versioned.** New output = new Asset row; never overwrite. Wrap
  `property_photos` **lazily + idempotently** at first use, guarded by a unique
  `(source_type, source_id)` constraint. No mass backfill.
- **Three separate state machines** (never one): Creative Job (`queued→running→rendering→
  uploading→qa→completed`, +`failed`/`cancelled`), Asset Lifecycle (`draft→ready_for_review→
  approved/rejected→archived`), Distribution (not in P2). The job ends at `completed`; the Asset
  it produced is `ready_for_review`.
- **Observability:** DB append-only transition log (source of truth) + **Sentry from P2**.
  PostHog deferred.
- **First-slice limits (do NOT exceed):** one deterministic video format · real photos only ·
  **one** Remotion template · **one** aspect ratio (16:9) · **no Veo/generative** · **no
  credits/billing** · **no Tour Engine** · **no automatic publication** (manual download only).
- **Placement:** the video-creation surface lives in **Edit Listing / Creative Studio**, NOT in
  `listing/new` Step 5. Step 5 keeps collecting the minimum assets to publish.
- **Flag:** new server-only `CREATIVE_STUDIO_VIDEO_ENABLED` (`"true"` to enable). Route fails
  closed to 404 when off (same pattern as the media-agent route).
- **No autonomous schema change.** Migrations are authored here + **idempotent** + applied by the
  owner via `supabase db push` after sign-off.
- Gates before each commit: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm migrations:check`,
  `pnpm build`. TDD: failing test → run red → minimal impl → run green → commit.

### Amendment (owner, 2026-07-15) — durability, reproducibility, decoupling

These are binding for every task; they override any looser wording elsewhere in this plan.

- **Truly async — the HTTP route is NOT the worker.** `POST …/generate` only creates a
  `queued` Creative Job and returns **202 + `{ jobId }`**. It never opens a Sandbox and never
  waits for a render. A **decoupled durable worker** claims and processes the job (see Task 7):
  in P2 this is a **secure Vercel Cron** route (`/api/creative-studio/video/worker`, protected by
  `CRON_SECRET`) that **atomically claims one `queued` job** (optimistic update guarded by
  `WHERE state='queued'`), processes it, and also **recovers abandoned jobs** (stuck in
  `running`/`rendering` past a heartbeat). No `fire-and-forget`/`waitUntil` from the route.
  Vercel Queues is the named upgrade path when throughput needs it.
- **Idempotency key.** The create request carries (or the route derives) an idempotency key
  `(listingId, templateVersion, ordered source asset ids hash)`; a matching in-flight/completed
  job is returned instead of starting a second render.
- **Conservative internal concurrency.** Do NOT rely on Sandbox's commercial max (2000). A
  configurable internal cap (`CREATIVE_STUDIO_MAX_CONCURRENCY`, default small, e.g. 2) bounds
  simultaneous renders; the worker respects it.
- **Prebuilt, versioned render artifact — never `npm install` per render.** Define a **prebuilt
  Sandbox base** (snapshot/image or a pre-provisioned source) with a pinned Node runtime
  (`node24`), Chromium, FFmpeg (for both render and `ffprobe`), and the exact Remotion packages
  already installed. Per job the Sandbox only: fetch manifest → download inputs → **run the
  render** (bundle-if-not-cached + `renderMedia`) → upload → cleanup. The base artifact has a
  **version** recorded in provenance.
- **Pin exact versions (no caret).** `remotion`, `@remotion/bundler`, `@remotion/renderer` MUST
  be the **same exact version** with no `^` (per Remotion's own guidance). Also pin
  `@vercel/sandbox`, the `node24` runtime, the base-artifact version, the template version, and
  the input-schema version. A video must be reproducible months later.
- **Separate bundle from render.** One **versioned bundle per template version**, many renders
  with different `inputProps`. Pass the **same `inputProps`** to `selectComposition()` and
  `renderMedia()`. Provenance records `templateId, templateVersion, bundleVersion,
  inputSchemaVersion, rendererVersion, renderProvider` — not just `provider: "remotion"`.
- **Private assets — download to the Sandbox, don't stream signed URLs through the whole
  render.** The **worker** (not the create request) generates signed URLs with a **sufficient
  TTL at job start**, downloads photos into the Sandbox temp filesystem, **validates
  hash/size**, and Remotion renders **from local files**; temps are deleted in a `finally`. The
  manifest sent to the Sandbox contains **no secrets** and **never** the Supabase service key.
- **Technical QA is concrete + binary (via `ffprobe`).** Before a job can reach `completed`:
  file exists, size > 0, MIME `video/mp4`, MP4 container, **H.264** codec, **exact resolution**,
  expected **FPS**, **duration within tolerance**, decodable (no missing frames), a computed
  **checksum**, upload confirmed, and the stored object's **signed URL is readable**. A
  successful render with a **failed upload is NOT `completed`** → it is `failed`. `completed`
  requires: upload OK + Asset created + QA passed + checksum & provenance persisted.
- **Cancellation / timeout / cleanup / recovery.** Support cancel **before** Sandbox creation and
  **during** render; always `sandbox.stop()` + temp cleanup in a `finally`; a job exceeding its
  **timeout** → `failed`; maintain a **heartbeat / `updated_at`**; the worker **recovers** jobs
  stuck in `running`/`rendering` with no heartbeat; bound **retries** (`max_attempts`), retrying
  only when safe (idempotency key prevents duplicate renders).
- **Two-level status.** Seller sees a **simplified** progression (Preparing → Creating →
  Finishing → Ready), **no invented progress percentages**; admin/support sees the **full**
  technical states + transition timeline. Error copy is reassuring and states the property was
  not changed.

## Per-task process (subagent-driven)
Implementer (TDD) → run tests → independent review vs this plan + the specs → code-quality
review (types, edge cases, i18n, no internal-term leaks, no placeholders) → fix → one atomic
commit per task.

## File structure (created/modified across the plan)

```
supabase/migrations/<ts>_creative_studio_video.sql   # assets + creative_jobs + creative_job_transitions (idempotent, author-only)
src/lib/assets/
  types.ts            # Asset, AssetKind, AssetLifecycle, AssetSource, provenance
  asset-manager.ts    # createAsset/getAsset/listAssets/wrapPropertyPhoto/selectForCapability (store injected)
  asset-manager.test.ts
src/lib/creative-jobs/
  states.ts           # CreativeJobState, legal transitions, pure nextTransition() builder
  states.test.ts
  jobs.ts             # persistence: createJob/appendTransition/setState (client injected)
  jobs.test.ts
src/remotion/
  index.ts            # registerRoot
  Root.tsx            # <Composition id="ListingVideo" .../>
  ListingVideo.tsx    # the deterministic Ken Burns slideshow (16:9)
  input.ts            # zod schema + pure helpers (per-photo durations, ordering)
  input.test.ts
src/lib/video-engine/
  versions.ts         # PINNED version constants: TEMPLATE_ID/VERSION, INPUT_SCHEMA_VERSION, RENDERER_VERSION, BASE_ARTIFACT_VERSION, RENDER_PROVIDER
  render-provider.ts  # RenderProvider interface + SandboxRemotionProvider (prebuilt artifact, bundle≠render, download-to-sandbox)
  render-provider.test.ts   # interface contract via a fake; NOT the real Sandbox
  qa.ts               # ffprobe-based technical QA (mp4/h264/res/fps/duration/checksum) — parser is pure + tested
  qa.test.ts
  pipeline.ts         # worker-side orchestration: claim→signed-urls→download→render→upload→asset→QA→transitions (deps injected)
  pipeline.test.ts
scripts/remotion-render.mjs        # runs INSIDE the Sandbox: bundle(cached per templateVersion) → selectComposition → renderMedia(h264)
docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md   # Spike P2.0 gate report (measurements, 3 runs, verdict)
src/app/api/creative-studio/video/generate/route.ts   # flag-gated: creates queued job, returns 202 + jobId (NO render)
src/app/api/creative-studio/video/generate/route.test.ts
src/app/api/creative-studio/video/worker/route.ts     # secure cron worker: atomic claim + process + recover abandoned
src/app/api/creative-studio/video/worker/route.test.ts
src/lib/observability/sentry.server.ts                # Sentry init + capturePipelineError
src/components/creative-studio-video-panel.tsx        # Edit Listing surface (2-level status, poster, preview, manual download)
src/lib/i18n.ts                                        # creativeStudio.* copy (en/es), incl. simplified seller status
```

---

## Spike P2.0 — MANDATORY architecture gate (before any pipeline work)

Vercel Sandbox + Remotion is an officially-supported but relatively recent integration. **Prove
it end-to-end on real infrastructure before building the pipeline.** This is a gate, not a note.
**Hard stop after this spike** for owner review — do not start Task 6/7 until it passes.

**Files:** a throwaway minimal composition (may be deleted after), `scripts/remotion-render.mjs`
(kept), the prebuilt Sandbox base definition, and the report
`docs/superpowers/spikes/2026-07-15-p2.0-sandbox-render.md`.

- [ ] **Step 1: Pin versions** — add to `package.json`, exact (no caret), all three Remotion
  packages the **same** version: `"remotion": "X.Y.Z"`, `"@remotion/bundler": "X.Y.Z"`,
  `"@remotion/renderer": "X.Y.Z"`, plus `"@vercel/sandbox": "A.B.C"`. Record the chosen versions
  in `src/lib/video-engine/versions.ts`.
- [ ] **Step 2: Build the prebuilt render base** — a versioned Sandbox base (snapshot/image or a
  pinned provisioned source) containing `node24`, Chromium, FFmpeg (+ `ffprobe`), and the pinned
  Remotion packages **pre-installed**. Record `BASE_ARTIFACT_VERSION`. The spike must **not**
  `npm install` on the per-render path.
- [ ] **Step 3: Minimal fixture render** — a **3-image, 10–15 s, 720p, no-audio** composition.
  In the Sandbox: `bundle` once (cache by template version) → `selectComposition` → `renderMedia`
  (codec `h264`) → produce `/tmp/out.mp4`.
- [ ] **Step 4: Run it for real, 3×** — measure and record for each run: Sandbox startup time,
  bundle time, render time, upload time, cleanup, peak CPU/mem, output size, approximate cost.
  Upload the output to a **test bucket** (not production). Confirm each MP4 is playable and passes
  a first `ffprobe` check (mp4/h264/720p/expected fps/duration).
- [ ] **Step 5: Prove the failure/cleanup paths** — demonstrate a **timeout** path, and that
  `sandbox.stop()` + temp cleanup run in a `finally` (no leaked Sandbox, no leaked temp files),
  and that credentials work from the worker context.
- [ ] **Step 6: Write the gate report** at the spikes path with the measurements and a verdict.

**Approval criteria (all required before continuing):** repeatable render (≥3 successful runs),
valid MP4 output each time, confirmed cleanup, working timeout handling, working credentials, and
recorded cost + duration. **If any fails, stop and escalate** — do not proceed to the pipeline.

**STOP POINT:** after the spike passes, pause for owner review before Task 6 (render provider)
and Task 7 (pipeline/worker).

---

## Task 1: Migrations — assets, creative_jobs, creative_job_transitions (idempotent, author-only)

**Files:** Create `supabase/migrations/<14-digit-ts>_creative_studio_video.sql` (generate via
`supabase migration new creative_studio_video`).

**Interfaces produced (DB shape later tasks rely on):** table `public.assets` (immutable rows),
`public.creative_jobs`, `public.creative_job_transitions` (append-only).

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new creative_studio_video` → note the generated path.

- [ ] **Step 2: Write the idempotent SQL**

Mandatory model requirements (owner, 2026-07-15) — the schema MUST encode all of these:
- **assets:** immutable + versioned (`version`, `parent_asset`), structured `provenance`,
  `checksum`, a **unique storage path**, `lifecycle` **independent of the job**, lazy-wrap
  idempotency via a **unique `(source_type, source_id)`** index; **no column whose UPDATE would
  replace an existing Asset's bytes** (storage fields are write-once — enforced by app + tests).
- **creative_jobs:** unique `idempotency_key` (active), initial state `queued`, `attempts` +
  `max_attempts`, `heartbeat_at`, `claimed_at` / `claimed_by`, `cancellation_requested`,
  `timeout_ms`, **structured `error_code`** (separate from `error_message`), user + listing
  ownership, separate `created_at`/`updated_at`.
- **transitions:** **append-only** (old/new state, `duration_ms`, `attempt`, `provider`, `cost`,
  `actor`, `metadata`, timestamp); **no UPDATE/DELETE from the application** (RLS denies both).
- **RLS:** the seller may only **SELECT** their own listings' assets/jobs/transitions; the seller
  **cannot INSERT/UPDATE/DELETE** any of them (all writes are server-side via the service client:
  the enqueue route after an ownership check, and the worker). Buckets/objects stay private.

```sql
-- Creative Studio P2: assets (immutable, versioned) + creative_jobs + transitions.
-- Idempotent: safe to re-run (IF NOT EXISTS; policies drop-then-create). Owner applies.
-- RLS: sellers are READ-ONLY; all writes go through the service client (route + worker).

create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.properties(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('photo','video','render','staging','tour','thumbnail')),
  version       integer not null default 1,
  parent_asset  uuid references public.assets(id) on delete set null,
  source_type   text not null,                 -- 'property_photo' | 'generated' | ...
  source_id     text,                           -- wrapped source id (nullable for pure-generated)
  provenance    jsonb not null default '{}'::jsonb,  -- {sourceAssetIds,capability,engine,provider,prompt,templateId,templateVersion,bundleVersion,inputSchemaVersion,rendererVersion}
  storage_bucket text not null,
  storage_path   text not null,                  -- write-once; see unique index below
  checksum      text,                            -- sha256 of the bytes (integrity + audit)
  bytes         bigint not null default 0,
  mime          text not null default '',
  cost_usd      numeric not null default 0,
  cost_provider text,
  created_by    uuid not null references auth.users(id) on delete cascade,
  lifecycle     text not null default 'draft'
                check (lifecycle in ('draft','ready_for_review','approved','rejected','archived')),
  qa            jsonb,
  policy        jsonb,
  created_at    timestamptz not null default now()
);
-- lazy-wrap idempotency: exactly one Asset per wrapped source
create unique index if not exists assets_source_unique
  on public.assets (source_type, source_id) where source_id is not null;
-- a storage object backs exactly one Asset row (no two Assets share bytes)
create unique index if not exists assets_storage_unique
  on public.assets (storage_bucket, storage_path);
create index if not exists assets_listing_idx on public.assets (listing_id);
create index if not exists assets_parent_idx  on public.assets (parent_asset);

create table if not exists public.creative_jobs (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid not null references public.properties(id) on delete cascade,
  owner_id               uuid not null references auth.users(id) on delete cascade,
  capability             text not null default 'video',
  state                  text not null default 'queued'
                         check (state in ('queued','running','rendering','uploading','qa','completed','failed','cancelled')),
  asset_id               uuid references public.assets(id) on delete set null,  -- set at 'uploading'
  idempotency_key        text not null,     -- (listingId, templateVersion, ordered source-asset hash)
  attempts               integer not null default 0,
  max_attempts           integer not null default 3,
  claimed_at             timestamptz,       -- set atomically when a worker claims the job
  claimed_by             text,              -- worker/instance id
  heartbeat_at           timestamptz,       -- refreshed while active; drives abandoned-job recovery
  cancellation_requested boolean not null default false,
  timeout_ms             integer not null default 600000,   -- 10 min job ceiling
  error_code             text,              -- structured (e.g. 'render_failed','upload_failed','timeout','qa_failed')
  error_message          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists creative_jobs_listing_idx on public.creative_jobs (listing_id);
create index if not exists creative_jobs_claimable_idx on public.creative_jobs (state, created_at);
-- one live job per identical request (idempotency). Partial: only non-terminal states.
create unique index if not exists creative_jobs_idempotency_active
  on public.creative_jobs (idempotency_key)
  where state in ('queued','running','rendering','uploading','qa');

create table if not exists public.creative_job_transitions (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.creative_jobs(id) on delete cascade,
  listing_id    uuid not null,
  user_id       uuid not null,             -- listing owner (for RLS)
  from_state    text not null,             -- old state
  to_state      text not null,             -- new state
  duration_ms   integer not null default 0,
  cost_usd      numeric not null default 0,
  cost_provider text,
  provider      text,
  capability    text,
  attempt       integer not null default 1,
  actor         text not null default 'system'  -- 'seller' | 'worker' | 'system'
                check (actor in ('seller','worker','system')),
  metadata      jsonb not null default '{}'::jsonb,
  error_code    text,
  error_message text,
  at            timestamptz not null default now()
);
create index if not exists creative_job_transitions_job_idx on public.creative_job_transitions (job_id);

alter table public.assets                   enable row level security;
alter table public.creative_jobs            enable row level security;
alter table public.creative_job_transitions enable row level security;

-- Sellers are READ-ONLY on all three tables (SELECT own only). No INSERT/UPDATE/DELETE policy
-- exists for any of them, so RLS denies writes to the seller by default; the service client
-- (route + worker) bypasses RLS for the controlled server-side writes. Transitions therefore
-- have NO update/delete path from the app at all -> append-only.
drop policy if exists "assets owner select" on public.assets;
create policy "assets owner select" on public.assets
  for select using (owner_id = auth.uid());

drop policy if exists "creative_jobs owner select" on public.creative_jobs;
create policy "creative_jobs owner select" on public.creative_jobs
  for select using (owner_id = auth.uid());

drop policy if exists "creative_job_transitions owner select" on public.creative_job_transitions;
create policy "creative_job_transitions owner select" on public.creative_job_transitions
  for select using (user_id = auth.uid());
```

- [ ] **Step 3: Validate + record the RLS/guarantee matrix**

Run: `pnpm migrations:check` → PASS. Do NOT `supabase db push` (owner-applied). In the commit
body, record the **guarantee matrix**: which guarantees are **DB-enforced** (idempotency unique
indexes, storage-path uniqueness, RLS seller-read-only, transitions append-only by absence of
write policies, state CHECK) vs **app-enforced + unit-tested** in Tasks 2–3 (immutable createAsset
issues no byte-replacing UPDATE, atomic claim via `WHERE state='queued'`, heartbeat recovery,
invalid-transition rejection, user/listing isolation in queries). DB-level behaviors are verified
by SQL review now and by the owner (or a local `supabase start` + pgTAP) on apply — note this
honestly (the repo has no live RLS integration harness yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_creative_studio_video.sql
git commit -m "feat(creative-studio): assets + creative_jobs + transitions migration (idempotent, RLS read-only, author-only)"
```

---

## Task 2: Asset Manager module (thin, store injected)

**Files:** Create `src/lib/assets/types.ts`, `src/lib/assets/asset-manager.ts`,
`src/lib/assets/asset-manager.test.ts`.

**Interfaces:**
- Produces: `Asset`, `AssetKind`, `AssetLifecycle`, `AssetSource`; and an `AssetStore` port
  (injected — a thin wrapper over Supabase) so logic is unit-testable with a fake.
- `createAsset(store, input): Promise<Asset>` — always inserts a new row (immutable).
- `wrapPropertyPhoto(store, { photo, listingId, ownerId }): Promise<Asset>` — idempotent: if an
  Asset with `(source_type:"property_photo", source_id: photo.id)` exists, return it; else insert.
- `selectForCapability(store, listingId, "video"): Promise<Asset[]>` — the photos a video uses,
  ordered.

**Mandatory (Gate A):** the `Asset` type carries `version`, `parentAsset`, structured
`provenance`, `checksum`, unique `(storageBucket, storagePath)`, and a `lifecycle` independent of
the job. The `AssetStore` port exposes **only** `insert`, `findBySource`, `listByListing`,
`getById` — **no update/replace of storage bytes**. `createAsset` computes/carries the checksum
and always inserts a new row. Explicit tests to include: (a) `wrapPropertyPhoto` is **idempotent**
(second wrap returns the same Asset, no new row); (b) `createAsset` **never mutates** an existing
Asset's bytes — there is no code path that updates `storageBucket`/`storagePath`/`bytes`/`checksum`
of an existing row (assert the store received no such update; a new version is a new row with
`parentAsset` set); (c) `listByListing` returns only the given listing's Assets (isolation);
(d) a version chain (`v1 → v2` via `parentAsset`) is retrievable.

- [ ] **Step 1: Write the failing test** (`asset-manager.test.ts`) — use an in-memory fake
  `AssetStore` that records inserts and enforces the unique `(source_type, source_id)` rule.

```ts
import { describe, it, expect } from "vitest";
import { createAsset, wrapPropertyPhoto } from "@/lib/assets/asset-manager";
import type { AssetStore, Asset } from "@/lib/assets/types";

function fakeStore(): AssetStore & { rows: Asset[] } {
  const rows: Asset[] = [];
  return {
    rows,
    async insert(a) { const row = { ...a, id: `a${rows.length + 1}`, createdAt: "T" } as Asset; rows.push(row); return row; },
    async findBySource(source_type, source_id) { return rows.find((r) => r.sourceType === source_type && r.sourceId === source_id) ?? null; },
    async listByListing(listingId) { return rows.filter((r) => r.listingId === listingId); },
  };
}

describe("wrapPropertyPhoto", () => {
  it("creates a v1 photo Asset on first wrap", async () => {
    const store = fakeStore();
    const a = await wrapPropertyPhoto(store, { photo: { id: "p1", url: "u", bucket: "b", path: "x" }, listingId: "L", ownerId: "O" });
    expect(a.kind).toBe("photo");
    expect(a.version).toBe(1);
    expect(a.sourceType).toBe("property_photo");
    expect(a.sourceId).toBe("p1");
    expect(store.rows).toHaveLength(1);
  });
  it("is idempotent — second wrap returns the same Asset, no new row", async () => {
    const store = fakeStore();
    const first = await wrapPropertyPhoto(store, { photo: { id: "p1", url: "u", bucket: "b", path: "x" }, listingId: "L", ownerId: "O" });
    const second = await wrapPropertyPhoto(store, { photo: { id: "p1", url: "u", bucket: "b", path: "x" }, listingId: "L", ownerId: "O" });
    expect(second.id).toBe(first.id);
    expect(store.rows).toHaveLength(1);
  });
});

describe("createAsset", () => {
  it("always inserts a new immutable row (never overwrites)", async () => {
    const store = fakeStore();
    await createAsset(store, { listingId: "L", ownerId: "O", kind: "video", version: 1, sourceType: "generated", sourceId: null, provenance: { sourceAssetIds: ["a1"], capability: "video", engine: "video-engine", provider: "remotion", prompt: null }, storageBucket: "renders", storagePath: "L/v1.mp4", bytes: 10, mime: "video/mp4", costUsd: 0, costProvider: "remotion", createdBy: "O", lifecycle: "ready_for_review" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].lifecycle).toBe("ready_for_review");
  });
});
```

- [ ] **Step 2: Run red** — `pnpm vitest run src/lib/assets/asset-manager.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `types.ts` then `asset-manager.ts`** — define the `Asset` type (camelCase
  mirror of the table), the `AssetStore` port (`insert`, `findBySource`, `listByListing`), and the
  three functions. `wrapPropertyPhoto` calls `findBySource("property_photo", photo.id)` first and
  returns it if present (idempotent); else builds a v1 photo Asset and inserts. `createAsset`
  inserts as-is. `selectForCapability` lists `kind:"photo"` Assets for the listing (ordering by a
  stable key). Keep all persistence behind the injected `store`.

- [ ] **Step 4: Run green** → PASS. **Step 5: gates. Step 6: commit**
  `feat(creative-studio): asset manager module — immutable assets + idempotent photo wrapping`.

---

## Task 3: Creative Job state machine + transition logging

**Files:** Create `src/lib/creative-jobs/states.ts`, `states.test.ts`, `jobs.ts`, `jobs.test.ts`.

**Interfaces:**
- `type CreativeJobState = "queued"|"running"|"rendering"|"uploading"|"qa"|"completed"|"failed"|"cancelled"`.
- `LEGAL_TRANSITIONS: Record<CreativeJobState, CreativeJobState[]>` and
  `canTransition(from, to): boolean`.
- `buildTransition(input): JobTransition` — pure; stamps `durationMs` (from a passed
  `enteredAt`/`now`, both provided by the caller — no `Date.now()` in pure code), `cost`,
  `provider`, `attempt`, `error`.
- `jobs.ts`: `createJob`, `appendTransition`, `setState` (Supabase client injected).

- [ ] **Step 1: Failing test for the state machine** (`states.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { canTransition, buildTransition } from "@/lib/creative-jobs/states";

describe("canTransition", () => {
  it("allows the happy path and forbids skips", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("rendering", "uploading")).toBe(true);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
  });
});

describe("buildTransition", () => {
  it("stamps duration from caller-provided timestamps and carries cost/provider/attempt", () => {
    const t = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "rendering", to: "uploading",
      enteredAtMs: 1000, nowMs: 4200, cost: { amountUsd: 0, provider: "remotion" },
      provider: "remotion", capability: "video", attempt: 1,
    });
    expect(t.durationMs).toBe(3200);
    expect(t.provider).toBe("remotion");
    expect(t.costProvider).toBe("remotion");
  });
  it("records an error only on → failed", () => {
    const t = buildTransition({ jobId: "j", listingId: "L", userId: "U", from: "rendering", to: "failed", enteredAtMs: 0, nowMs: 10, attempt: 2, error: { code: "render_timeout", message: "x" } });
    expect(t.errorCode).toBe("render_timeout");
    expect(t.attempt).toBe(2);
  });
});
```

- [ ] **Step 2: Run red → Step 3: implement `states.ts`** with `LEGAL_TRANSITIONS`
  (`queued→[running,cancelled]`, `running→[rendering,failed,cancelled]`,
  `rendering→[uploading,failed,cancelled]`, `uploading→[qa,failed]`, `qa→[completed,failed]`,
  terminal `completed`/`failed`/`cancelled`→[]) and a pure `buildTransition`. **Step 4: green.**

- [ ] **Step 5: `jobs.ts` + `jobs.test.ts`** — the durable job layer (Supabase client injected;
  tested against an in-memory fake `JobsStore` that mimics the DB semantics). It MUST provide:
  - `createJob(store, input)` — inserts in state `queued` with `idempotencyKey`; if an **active**
    job with the same key exists, returns it (no duplicate) — simulates the partial-unique index.
  - `claimNextQueued(store, workerId)` — **atomic claim**: sets `state='running'`,
    `claimed_at`/`claimed_by`, guarded by `WHERE state='queued'` semantics so **two concurrent
    claimers cannot both win** the same job (the fake must model the compare-and-set).
  - `setState(store, jobId, to, meta)` — guarded by `canTransition` (throws on illegal), bumps
    `updated_at`, and **appends a transition** (`appendTransition`) in the same logical step;
    refreshes `heartbeat_at` on active states; on `failed` sets a **structured `error_code`**.
  - `recoverAbandoned(store, now, staleMs)` — jobs in `running`/`rendering` whose `heartbeat_at`
    is older than `staleMs` → re-`queued` if `attempts < max_attempts` (increment `attempts`),
    else → `failed` (`error_code='timeout'`).
  - `requestCancel(store, jobId)` — sets `cancellation_requested`; a claimer/worker honors it.
  - `appendTransition` — insert only (append-only); never updates/deletes a transition.

  **Explicit tests to include:** invalid transition rejected (`queued→completed` throws);
  concurrent `claimNextQueued` — only one of two callers gets the job, the other gets none;
  duplicate `createJob` with the same idempotency key returns the same job (no second row);
  `recoverAbandoned` re-queues a stale job and fails it past `max_attempts`; `requestCancel` marks
  the job and a subsequent claim/step honors it; `appendTransition` is append-only (no update/delete
  API exists); a job/transition query is scoped to its owner (isolation).

- [ ] **Step 6: gates + commit**
  `feat(creative-studio): creative-job state machine, durable jobs (atomic claim, heartbeat, recovery, idempotency) + append-only transitions`.

---

## Task 4 (Gate B1): Remotion composition — brand-first `ListingVideo` (16:9)

**Design intent (owner, 2026-07-15) — this is a brand asset, not a "make Remotion render" exercise.**
This first template becomes the base for many future formats, so design it to the Lixtara identity
now (see `brand_identity` memory: ivory ground, Playfair-style serif, restrained gold accents,
editorial-luxury). The composition MUST have:
- **A clean opening** card with the property **address / name** (serif, generous whitespace) — no
  flashy intro.
- **Discreet transitions** between photos (slow Ken-Burns + soft crossfade; no zoom-punches,
  spins, or gimmicks).
- **Consistent typography** with the Lixtara brand (serif display for the address/price, clean sans
  for secondary text).
- **A reserved safe area** for **future badges** ("New", "Price Reduced", "Open House", …) — a
  defined corner region the layout keeps clear, so badges can drop in later without a redesign.
- **A closing card** with a **call-to-action** + Lixtara branding.

**Files:** Create `src/remotion/index.ts`, `src/remotion/Root.tsx`, `src/remotion/ListingVideo.tsx`,
`src/remotion/input.ts`, `src/remotion/input.test.ts`, `src/remotion/layout.ts` (safe-area + timing
constants). Add **exact-pinned** `remotion` / `@remotion/bundler` / `@remotion/renderer` **all
`4.0.489`** (no caret) to `package.json`.

**Interfaces:**
- `listingVideoInputSchema` (zod): `{ property: { addressLine: string; name?: string }; priceLabel:
  string; photos: { url: string; roomLabel?: string }[] (min 1); brand: { name: string };
  cta: { text: string }; badge?: { text: string } | null }` — `badge` is **reserved/optional**,
  rendered into the safe area only if present (P2 always passes `null`).
- Pure helpers in `input.ts` (unit-tested; JSX is not): `perPhotoDurationFrames(photoCount, fps,
  photoSeconds): number`, `orderedPhotos(photos)`, and `totalDurationFrames(photoCount, fps, opts)`
  (opening + photos + closing). `layout.ts`: `SAFE_AREA` (the badge-reserved rect) + timing consts.
- Composition id `"ListingVideo"`, **1920×1080, 30 fps**.

> **Note — `trace_id` lives on the job/transition, NOT the composition.** The composition is a pure
> function of `inputProps`; correlation IDs stay in the Creative Job layer (see the pre-Task-4 prep).
> Keep the composition free of runtime/observability concerns.

- [ ] **Step 1: Failing tests for the pure helpers + schema** (`input.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { perPhotoDurationFrames, totalDurationFrames, listingVideoInputSchema } from "@/remotion/input";

const valid = { property: { addressLine: "123 Main St, Doral FL" }, priceLabel: "$450,000",
  photos: [{ url: "u" }], brand: { name: "Lixtara" }, cta: { text: "See more at lixtara.com" }, badge: null };

describe("perPhotoDurationFrames", () => {
  it("splits photo time across photos in whole frames", () => {
    expect(perPhotoDurationFrames(5, 30, 4)).toBe(120); // 4s*30 = 120 frames each
  });
  it("never returns zero", () => { expect(perPhotoDurationFrames(1, 30, 3)).toBe(90); });
});

describe("totalDurationFrames", () => {
  it("includes opening + photos + closing", () => {
    // opening 2s + 3 photos*4s + closing 2s = 16s * 30 = 480
    expect(totalDurationFrames(3, 30, { photoSeconds: 4, openingSeconds: 2, closingSeconds: 2 })).toBe(480);
  });
});

describe("listingVideoInputSchema", () => {
  it("accepts a valid input and rejects an empty photo list", () => {
    expect(listingVideoInputSchema.safeParse(valid).success).toBe(true);
    expect(listingVideoInputSchema.safeParse({ ...valid, photos: [] }).success).toBe(false);
  });
  it("accepts an optional badge in the reserved slot", () => {
    expect(listingVideoInputSchema.safeParse({ ...valid, badge: { text: "Price Reduced" } }).success).toBe(true);
  });
});
```

- [ ] **Step 2: red → Step 3: implement** `input.ts` (schema + pure helpers), `layout.ts`
  (`SAFE_AREA` badge rect + opening/photo/closing timing), then `ListingVideo.tsx`:
  **opening card** (address/name, serif, ivory) → **photo sequences** (`<Series>`/`<Sequence>` +
  `<Img>` + gentle `interpolate`-driven Ken-Burns + soft crossfade; price/room lower-third; keep the
  `SAFE_AREA` clear; render `badge` there iff present) → **closing card** (CTA + Lixtara mark).
  `Root.tsx` registers `<Composition id="ListingVideo" component={ListingVideo}
  durationInFrames={totalDurationFrames(...)} fps={30} width={1920} height={1080}
  schema={listingVideoInputSchema} defaultProps={…} />`; `index.ts` = `registerRoot(Root)`.
  **Step 4: green** (helper + schema tests). Fonts: embed a Playfair-style serif via
  `@remotion/google-fonts` or a bundled font so the render is self-contained (no external fetch).

- [ ] **Step 5: LOCAL visual validation (no Sandbox, no ffmpeg needed).** Render **still frames**
  locally with `@remotion/renderer`'s `renderStill` (stills need only Chromium, which Remotion
  downloads — **no ffmpeg**): capture representative frames — **opening**, a **mid photo**, the
  **safe-area with a sample badge**, and the **closing CTA** — to PNGs in a scratch dir. Confirm the
  brand look (typography, ivory/gold, discreet framing, safe area clear). Save these PNGs to attach
  to the delivery. (A full local MP4 is optional and needs ffmpeg — skip it; the real MP4 render is
  Task 5 on Sandbox.)

- [ ] **Step 6: gates** (`pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build` — build must
  pass with the new pinned deps). **Step 7: commit**
  `feat(creative-studio): brand-first ListingVideo Remotion composition (16:9) + input schema + safe-area`.

**Limits:** one template, one aspect ratio (16:9), no audio. **Do NOT** wire Sandbox, the Asset
Manager, or Creative Jobs here (that is Gate B2 / Task 5). This task is the composition only.

---

## Task 5 (Gate B2): Render Provider — Assets → Sandbox/Remotion → QA → Storage → video Asset

**Precondition:** Spike P2.0 passed (verdict PASS). Reuse its validated render approach + prebuilt
base artifact. **No `npm install` on the render path.** **Scope (owner, 2026-07-15):** prove the
provider turns **existing source Assets** into a **valid, auditable, immutable video Asset**. This
task validates ONLY: source Assets → minimal manifest → Vercel Sandbox → Remotion → temp MP4 →
ffprobe + SHA-256 → Supabase Storage → new versioned video Asset. **Do NOT** build: public route,
cron, full worker, Sentry, UI, approval, publishing, credits, regeneration.

**Files:** `src/lib/video-engine/versions.ts`, `render-provider.ts` (+test), `qa.ts` (+test),
`manifest.ts` (+test), `produce-asset.ts` (+test), `storage-port.ts`.

### Mandatory requirements (each maps to a test)
1. **Provider is SEPARATE from the state machine.** `produceVideoAsset(...)` returns a structured
   `RenderResult { outputAsset, technicalQa, metrics, provenance }` and **never** decides
   `completed`/`failed`/`approved`/`published` — the Task-6 orchestrator owns job transitions.
2. **Minimal, secret-free manifest** to the Sandbox: only normalized `inputProps`, versions, a
   `traceId`, and non-sensitive technical config. **Never** the Supabase service key, Vercel
   tokens, credentials, or unnecessary private listing/seller data. (Test: a manifest builder whose
   output is asserted to contain none of a set of secret markers.)
3. **Download source Assets to a temp filesystem**, validate size/hash when available, render from
   **local paths** (no signed URLs streamed through the whole render).
4. **Full provenance** on the video Asset: `sourceAssetIds`, `templateId`, `templateVersion`,
   `bundleVersion`, `inputSchemaVersion`, `rendererVersion`, `renderProvider`, `traceId`.
5. **Technical QA BEFORE creating the Asset** (via `ffprobe` + a pure parser): container=mp4,
   codec=**h264**, **1920×1080**, **30 fps**, duration within tolerance, decodable, bytes>0, and a
   **real SHA-256** of the bytes.
6. **Persistence order (exact):** temp render → QA → checksum → upload → **read-verify** → create
   Asset. A **failed QA or failed upload NEVER yields a completed/created video Asset**.
7. **Orphan handling:** if the upload succeeds but Asset creation fails, **remove the uploaded
   object** (or leave a reconcilable record) — never silently swallow the failure. (Test: inject a
   `createAsset` that throws after a successful upload → assert `storage.remove` was called.)
8. **Prebuilt artifact** (spike-confirmed): Node 24, Chromium + libs, ffmpeg/ffprobe, xz, pinned
   Remotion — **no npm install per job**. Fonts are already vendored locally (Task 4) — the render
   needs **no network egress** for fonts.
9. **`sandbox.stop()` in `finally`** on success, error, timeout, AND cancellation; temp files
   cleaned in `finally` too.
10. **Separated metrics** (not one total): `sandboxStartupMs`, `assetDownloadMs`, `bundleMs`,
    `selectCompositionMs`, `renderMs`, `qaMs`, `uploadMs`, `totalMs`, `outputBytes`,
    `estimatedCostUsd`.
11. **Badge stays supported by the composition but P2 passes `badge: null`.**

### Interfaces
```ts
// versions.ts — pinned constants
export const TEMPLATE_ID = "ListingVideo";
export const TEMPLATE_VERSION = "1"; export const INPUT_SCHEMA_VERSION = "1";
export const RENDERER_VERSION = "4.0.489"; export const RENDER_PROVIDER = "vercel-sandbox";
export const BASE_ARTIFACT_VERSION = "<set from the built base>";

interface RenderProvider { render(input: RenderInput): Promise<RenderMediaOutput> }
type RenderInput = { compositionId: string; templateVersion: string; localAssetPaths: string[]; inputProps: unknown };
type RenderMediaOutput = { bytes: Buffer; mime: "video/mp4"; provider: "vercel-sandbox"; renderer: "remotion";
  bundleVersion: string; baseArtifactVersion: string;
  metrics: { sandboxStartupMs: number; bundleMs: number; selectCompositionMs: number; renderMs: number } };
class SandboxRemotionProvider implements RenderProvider {}   // real integration (spike-based)
class FakeRenderProvider implements RenderProvider {}         // fixed small mp4 buffer; ALL unit tests use this

interface StoragePort {
  upload(path: string, bytes: Buffer, contentType: string): Promise<{ bucket: string; path: string; bytes: number }>;
  readVerify(bucket: string, path: string): Promise<boolean>;   // signed-url readable
  remove(bucket: string, path: string): Promise<void>;          // orphan cleanup
}
type TechnicalQaResult = { ok: boolean; container: string; codec: string; width: number; height: number;
  fps: string; durationSec: number; bytes: number; checksumSha256: string; checks: Record<string, boolean> };
type RenderProvenance = { sourceAssetIds: string[]; templateId: string; templateVersion: string;
  bundleVersion: string; inputSchemaVersion: string; rendererVersion: string; renderProvider: string; traceId: string | null };
type RenderMetrics = { sandboxStartupMs: number; assetDownloadMs: number; bundleMs: number;
  selectCompositionMs: number; renderMs: number; qaMs: number; uploadMs: number; totalMs: number;
  outputBytes: number; estimatedCostUsd: number };
type RenderResult = { outputAsset: Asset; technicalQa: TechnicalQaResult; metrics: RenderMetrics; provenance: RenderProvenance };

// the orchestrator — NEVER touches the Creative Job state machine
function produceVideoAsset(input: {
  listingId: string; ownerId: string; sourceAssets: Asset[]; inputProps: unknown; traceId: string | null;
}, deps: {
  render: RenderProvider; runQa: (localMp4: string, expected: {...}) => Promise<TechnicalQaResult>;
  storage: StoragePort; assets: AssetStore; downloadAssets: (a: Asset[]) => Promise<string[]>; now: () => number;
}): Promise<RenderResult>;
```

- [ ] **Step 1 (TDD, fakes only — CI never opens a Sandbox):** `render-provider.test.ts`
  (FakeRenderProvider contract), `qa.test.ts` (pure `parseFfprobe` against a captured JSON fixture:
  pass on mp4/h264/1920×1080/30fps/duration-in-tolerance; fail with the specific failing check),
  `manifest.test.ts` (builder output contains inputs+versions+traceId and **none** of a secret-marker
  set), `produce-asset.test.ts` with all deps faked, asserting: **persistence order** (render→QA→
  checksum→upload→readVerify→createAsset); **QA fail → no upload, no Asset, throws**; **upload fail →
  no Asset**; **orphan** (createAsset throws after upload → `storage.remove` called, then rethrow);
  **provenance completeness** (all 8 fields set); **RenderResult never mutates a job** (there is no
  job/state import in this module); **separated metrics** all present; **badge null** passed through.
- [ ] **Step 2: red → Step 3: implement** `versions.ts`, `qa.ts` (pure `parseFfprobe` +
  `runFfprobe`), `manifest.ts` (minimal builder), `storage-port.ts` (interface + a Supabase-backed
  impl behind it, and a fake for tests), `render-provider.ts` (`FakeRenderProvider` +
  `SandboxRemotionProvider` built on the spike: create from prebuilt base → copy local asset files
  in → `bundle`(cached per templateVersion)→`selectComposition`→`renderMedia` h264 (same inputProps)
  → read bytes; `finally` `sandbox.stop()` + temp cleanup), and `produce-asset.ts` implementing the
  exact persistence order + orphan handling. **Step 4: green (unit).**
- [ ] **Step 5: REAL Sandbox validation (controller-driven gate).** Render the **actual
  `ListingVideo` composition** through `SandboxRemotionProvider` on a real Vercel Sandbox with 3
  fixture photos + `badge: null`: confirm a valid MP4 (ffprobe: mp4/h264/1920×1080/30fps/expected
  duration), a real SHA-256, separated metrics, `sandbox.stop()` in every path, and that the manifest
  carried no secrets. Record the metrics/cost. (Storage upload + Asset creation are exercised by the
  fake `StoragePort`/`AssetStore` in unit tests — the **real** Supabase Storage upload + real Asset
  row require the owner-applied migration + a bucket, which are **out of scope** here; the real run
  proves the render+QA+checksum half, the fakes prove the persistence-order + orphan half.)
- [ ] **Step 6: gates (unit only) + commit**
  `feat(creative-studio): render provider — Assets→Sandbox/Remotion→ffprobe/sha256→(storage port)→video Asset (RenderResult; no state-machine coupling)`.

**Rollback:** the render target sits behind `RenderProvider`; a swap to the Lambda escape hatch (if
an ADR trigger fires) is one adapter change. Nothing here is flag-exposed or reachable by a seller.

---

## Task 6 = Gate C1 (durable orchestration, NO external infra) + Gate C2 (integrated validation, deferred)

Task 6 is split (owner, 2026-07-15). **Gate C1 = code only.** Do NOT apply the migration, create a
bucket, set flags, run a real job, or touch any UI. Stop after C1 for review. **Gate C2** (below)
is a separate authorization.

### State-machine realignment (do FIRST — the current order contradicts the real flow)
Gate B2's `produceVideoAsset` runs render → **QA** → checksum → upload → read-verify → createAsset,
so **technical QA happens BEFORE upload**. Change `src/lib/creative-jobs/states.ts` `LEGAL_TRANSITIONS`
to: `queued→[running,cancelled]`, `running→[rendering,failed,cancelled]`,
`rendering→[qa,failed,cancelled]`, `qa→[uploading,failed]`, `uploading→[completed,failed]`, terminals
`[]`. (i.e. `rendering → qa → uploading → completed`.) Update `states.test.ts`/`jobs.test.ts` to the
new order. `completed` is reached ONLY after render + QA + checksum + upload + read-back + Asset
created + the transition persisted.

### Stable error codes (new `src/lib/creative-jobs/errors.ts`, TDD)
`export type CreativeJobErrorCode` = one of: `ASSET_DOWNLOAD_FAILED`, `SANDBOX_CREATE_FAILED`,
`RENDER_FAILED`, `RENDER_TIMEOUT`, `TECHNICAL_QA_FAILED`, `STORAGE_UPLOAD_FAILED`,
`STORAGE_VERIFY_FAILED`, `ASSET_CREATE_FAILED`, `JOB_CANCELLED`, `JOB_ATTEMPTS_EXHAUSTED`. Each is
**classified** `retriable | non_retriable | cancelled` via a map (`ERROR_CLASS[code]`). The UI and
retry logic depend on the **code**, never on `error_message` (which holds sanitized detail only).

### Conservative config (new `src/lib/video-engine/config.ts`, env-driven, safe defaults)
`CREATIVE_VIDEO_MAX_JOBS_PER_RUN` (default 1), `CREATIVE_VIDEO_MAX_CONCURRENCY` (default 1),
`CREATIVE_VIDEO_JOB_TIMEOUT_MS` (default 600000), `CREATIVE_VIDEO_HEARTBEAT_MS` (default 15000),
`CREATIVE_VIDEO_STALE_AFTER_MS` (default 120000). The cron respects a **time budget** + concurrency
and leaves the rest `queued` — **the cron is not an infinite queue drain.**

### Supabase adapters (code only; NOT run against a real DB in C1 — tested with a mock client / fakes)
- `JobsStore` Supabase impl: `claimNextQueued` = a real atomic `update … set state='running',
  claimed_at, claimed_by where id=? and state='queued' returning *` (compare-and-set); `createJob`
  catches the partial-unique-index violation (`23505`) and returns the existing active job;
  `setState`/`appendTransition`/`recoverAbandoned`/`requestCancel` as designed. RLS-bypassing service
  client (server-only).
- `AssetStore` Supabase impl (immutable insert; provenance jsonb; checksum content-sha256-or-null).
- `StoragePort` Supabase Storage impl: `upload` (private, validated MIME + size), `readVerify`
  (short-lived signed URL readable), `remove` (orphan cleanup). **Path (no PII, unpredictable):**
  `creative-studio/{ownerId}/{listingId}/{assetId}/v{version}/listing-video.mp4`.

### Enqueue route — `POST /api/creative-studio/video/generate` (202, never renders)
- Requires: **auth**, **listing ownership**, **feature flag** (`CREATIVE_STUDIO_VIDEO_ENABLED` → else
  404), **readiness** (reuse the readiness gate — video must be `ready`). **Rejects any
  client-supplied** `ownerId`/`provider`/`state`/`storagePath`/`idempotencyKey` — the server builds
  the idempotency key from controlled data: `hash(listingId + capability + TEMPLATE_VERSION +
  normalized sourceAssetIds + normalized inputHash)`. `createJob` (idempotent) → **202 `{ jobId }`**
  with only safe job fields. Never opens a Sandbox. Rate-limited.
- Tests: 404 flag-off; 401 unauth; 403 not-owner; 422 not-ready; 202 + jobId; **duplicate → same
  jobId**; **client-supplied ownerId/state/idempotencyKey ignored**; response body carries no secrets.

### Worker — `POST /api/creative-studio/video/worker` (secure cron, batch, budget)
- **CRON_SECRET** verified with a **timing-safe** compare (401 otherwise). Claims **up to
  `MAX_JOBS_PER_RUN`** atomically, respects `MAX_CONCURRENCY` and a **time budget**, leaves the rest
  `queued`, runs the **abandoned-job sweep** (stale heartbeat → re-queue if `attempts<max` else
  `failed` `JOB_ATTEMPTS_EXHAUSTED`), honors `cancellation_requested`. Never accepts an arbitrary
  job id from the internet. No stack traces in the response. Registered as a Vercel Cron.
- Tests: no/invalid secret → 401 (timing-safe); atomic claim (two concurrent workers → one wins);
  batch cap + budget honored; recovery of stale job; cancellation honored.

### Pipeline — wire `produceVideoAsset` into the job lifecycle
`processJob(job, deps)`: set states **as facts become true** — `running` (claimed) → `rendering`
(just before the provider) → `qa` (after render, before upload) → `uploading` (upload + read-back +
createAsset) → `completed` (only after the Asset row + transition persisted). `produceVideoAsset`
stays **state-machine-free**; the pipeline maps its stages to transitions and to **error codes** on
failure. **Retry safety:** on retry, do NOT duplicate the Asset or the Storage object — use the
idempotency key + reconciliation (detect an already-persisted result for this job/key and adopt it
rather than re-uploading/re-creating). `sandbox.stop()` + temp cleanup always in `finally`.
- Tests (fakes): full happy path with the NEW state order; each failure stage → correct `error_code`
  + classification + no partial Asset; retry does not duplicate Asset/object (reconciliation);
  cancellation mid-flight; heartbeat updated per state.

### Sentry in code (no DSN required in C1) — sanitized
`capturePipelineError(err, ctx)` sends **only technical tags**: `trace_id`, `job_id`, `stage`,
`error_code`, `attempt`, `render_provider`, `template_version`. **Never** signed URLs, the full
manifest, the property address/PII, secrets, private prompts, or full Supabase bodies. Fail-open if
unconfigured. Test asserts the payload contains only the allowed tags and none of a
sensitive-marker set.

### C1 exit / stop
Gates green; **migration NOT applied, no bucket created, no flag set, no real job, no UI touched**
(do NOT modify Step 5 or the 3D-tour block). Deliver the C1 report, then **stop**.

---

## Gate C2 — integrated validation (DEFERRED — separate authorization)
Only after C1 review: Supabase local/staging, **apply migration**, create a **private bucket**, run
**one real job** end-to-end, verify the Asset row + Storage object + transitions + job, test
idempotency/retry/recovery/orphan cleanup, fire a controlled Sentry event. No public UI, no
seller-facing activation. This is where "an Asset persisted end-to-end on real infra" is finally
proven — C1 proves the code; C2 proves the integration.

---

## Task 7 = Gate D1 — Production Integration (backend; NO UI) — reframed (owner, 2026-07-16)

Not "wire route+worker" anymore — this **connects the validated platform to the product**. Renderer,
Asset Manager, Storage, and Jobs already exist and are validated (Gate B2/C1/C2). Gate D1 wires the
REAL end-to-end backend, flag-gated, with **no seller UI**. **Stop after D1 for review.**

**Already done (do not rebuild):** Sentry (`src/lib/observability/sentry.server.ts`) — sanitized,
generic-code message, size-capped (C1-d + C2 fix). Enqueue route + cron worker skeleton (C1-c/d).
Real Supabase adapters (C1-b). `produceVideoAsset` orchestrator (B2).

Gate D1 delivers:
- [ ] **Wire the REAL `produce` + `reconcile` into the worker** (replace the C1-d stubs):
  `produce` = `produceVideoAsset` with real deps — `SandboxRemotionProvider` (real render, prebuilt
  artifact), `downloadAssets` (signed URLs at job start → temp files), local-in-sandbox ffprobe QA,
  `SupabaseVideoStoragePort`, `SupabaseAssetStore`; `reconcile` = query the real DB for an
  already-persisted Asset for this job/idempotency (adopt it, no re-render). Tests with fakes; the
  real path validated like C2 (local Supabase + REAL Sandbox this time — closes the one thing C2
  stubbed).
- [ ] **Sentry init** — `@sentry/nextjs` `instrumentation` reading `SENTRY_DSN` (server-only);
  `capturePipelineError` already sanitized. Fail-open when DSN unset.
- [ ] **Feature flags / rollout** — `CREATIVE_STUDIO_VIDEO_ENABLED` (route, fail-closed 404) +
  `CRON_SECRET` (worker, timing-safe). Document the rollout order; no seller exposure.
- [ ] **Metrics / observability** — persist the separated render metrics + cost onto the job/asset
  (or transition metadata); an admin-only read of the transition timeline. DB log is the source of
  truth; Sentry for errors. No PostHog.
- [ ] **Owner-only external steps documented** (activation runbook update): apply migration to prod,
  create the private prod bucket, set the flags/DSN, build the prebuilt artifact.

**D1 limits:** no UI, no auto-publish, no Veo/generative, no credits, no Tour Engine, no
multi-generation. Do NOT touch Step 5 or the 3D-tour block. **Stop after D1.**

---

## Task 8 = Gate D2 — Seller Experience (UI) — DEFERRED (separate authorization)

Only after Gate D1 review. The seller-facing surface in **Edit Listing** (NEVER onboarding Step 5):
- **"Create Listing Video"** (NOT "Generate Video"), subtitle **"Uses your existing listing photos."**
- Simplified status (Preparing → Creating → Finishing → Ready — **no fake %**); poster-first preview;
  manual **download**; reassuring error copy ("We couldn't finish your video. Your photos and listing
  were not changed. / Try again"); polling; **EN/ES**; accessibility (native controls + text
  description); mobile responsive. Two-level status (seller simplified vs admin technical).
- **No** auto-publish, regenerate, Veo, credits, Tour Engine, or multi-generation in P2. Surface lives
  in Edit Listing / Creative Studio, never Step 5.

---

## Rollback (whole feature)

- **Instant disable (two levers):** unset `CREATIVE_STUDIO_VIDEO_ENABLED` → the enqueue route
  404s and the panel hides; unset/rotate `CRON_SECRET` (or disable the cron) → the worker stops
  claiming jobs. No data migration needed to disable.
- **Schema rollback:** `drop table if exists public.creative_job_transitions, public.creative_jobs, public.assets cascade;` (drops dependent policies/indexes). `assets` is new; nothing else references it. Document in the activation runbook.
- **Provider rollback:** the render target is behind `RenderProvider`; swapping `SandboxRemotionProvider` for the Lambda escape hatch (if an ADR trigger fires) is one adapter change (ADR §5).
- **In-flight jobs:** disabling mid-flight leaves jobs claimable-but-unclaimed; the worker's
  abandoned-job sweep marks stale `running`/`rendering` jobs `failed` (bounded by `max_attempts`).

## Exit criteria (P2 done)

**Gate first:** Spike P2.0 passed (≥3 repeatable real renders, valid MP4, cleanup, timeout, cost
recorded). Then, for a real listing with real photos, flag on, from Edit Listing:
1. `POST …/generate` returns **202 `{ jobId }`** (never renders in-request); a **decoupled cron
   worker** claims and processes the job through `queued→running→rendering→uploading→qa→completed`,
   each transition logged with duration/cost/provider/attempt; the same request twice → one job
   (idempotency).
2. A real, playable **MP4** exists in **Supabase Storage** as an **immutable, versioned
   `kind:"video"` Asset**, produced from **locally-downloaded** photos, with full provenance
   (`templateId/templateVersion/bundleVersion/inputSchemaVersion/rendererVersion/renderProvider`,
   source asset ids, cost) + checksum, and `lifecycle: ready_for_review`. `completed` was reached
   **only after** upload + Asset creation + **ffprobe QA** (mp4/h264/exact-res/fps/duration) passed;
   a failed upload would have been `failed`, not `completed`.
3. The seller sees a **simplified** status (Preparing→Creating→Finishing→Ready), no invented %, and
   can **poster-preview + manually download** — no auto-publish, no regenerate.
4. Errors captured in **Sentry**; DB transition log is the operational source of truth; cancel /
   timeout / abandoned-job recovery / `max_attempts` / conservative internal concurrency all hold.
5. Nothing in onboarding Step 5. No Veo, no credits, no Tour Engine, one 16:9 template. Versions
   pinned (no caret; all Remotion packages equal); no `npm install` on the render path.
6. All five gates pass; the migration is idempotent and NOT auto-applied.

## Self-review
- **Spec coverage:** ADR (Sandbox, Pro, escape hatch, sync→async decoupling) → Spike + Tasks 5/6 +
  constraints; Asset Manager (immutable/versioned/lazy-wrap/Supabase SoT/provenance versions) →
  Tasks 1/2/6; observability (3 machines, DB log + Sentry, heartbeat/recovery) → Tasks 1/3/6/7;
  placement (not Step 5) → Task 8; first-slice limits → each task's **Limit** note. Covered.
- **Amendment coverage (2026-07-15):** (1) 202 + decoupled cron worker → Task 6a/6d + constraints;
  (2) mandatory Spike P2.0 gate → its own section, hard stop; (3) prebuilt artifact, no per-render
  install → constraints + Spike + Task 5; (4) exact pinned versions → constraints + versions.ts +
  Spike; (5) bundle≠render + provenance versions → Task 5 + Task 6c; (6) ffprobe QA + completed-only-
  after-upload → Task 6b/6c; (7) cancel/timeout/heartbeat/recovery/max-attempts/idempotency/
  conservative concurrency → schema Task 1 + Task 6c/6d + constraints; (8) private assets downloaded
  via signed URLs at job start, no service key in manifest → constraints + Task 6c; two-level status
  + no fake % → Task 8. All present.
- **Placeholder scan:** no vague TODOs. The Spike is a concrete measured gate; the render provider
  code path is specified with real Remotion/Sandbox calls built on the validated spike.
- **Type consistency:** `Asset`/`AssetStore`/`CreativeJobState`/`RenderProvider`/`RenderInput`/
  `RenderOutput`/`processJob`/`buildTransition`/`parseFfprobe`/`sellerStatus`/`capturePipelineError`
  used identically across tasks.

## Stop here
Do not implement. Execution is subagent-driven and **starts with Spike P2.0, with a mandatory stop
after the Sandbox is validated** before the full pipeline. Owner-only external steps (apply
migration, set `CREATIVE_STUDIO_VIDEO_ENABLED`, provision `CRON_SECRET` + `SENTRY_DSN`, confirm
Vercel Pro, build the prebuilt render artifact) come after review.

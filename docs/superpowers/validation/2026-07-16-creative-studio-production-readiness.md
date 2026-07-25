# Creative Studio — Production Readiness Checklist

**Not an ADR, not a plan.** A short go-live checklist. `✅ validated` · `◻ pending` · `⏳ in a later gate`.
Each validated item names the gate that proved it.

## Infrastructure (the platform is technically sound)
- ✅ **Sandbox render validated** — real Vercel Sandbox renders the real `ListingVideo` to a valid
  h264/1920×1080/30fps MP4 (Gate B2; iad1/node24; render ~19.6s).
- ✅ **Storage validated** — real uploads to a **private** bucket, read-verify via short-lived
  signed URL, orphan removal; no-PII path (Gate C2, real local Supabase).
- ✅ **RLS validated** — sellers read-only on assets/jobs/transitions; writes only via service
  client; transitions append-only (Gate C1 review + C2 real DB).
- ✅ **Exactly-once validated** — one request never yields two Assets/objects/jobs; verified by SQL
  (35 assets == 35 objects, 1 per completed job) (Gate C2).
- ✅ **Recovery validated** — stale-heartbeat jobs in any active state (running/rendering/qa/uploading)
  are recovered; reconciliation prevents duplicates (Gate C2 + fix `0ba00a2`).
- ✅ **Cleanup validated** — QA/upload/createAsset failures leave 0 Assets/objects; uploaded object
  removed on createAsset failure (Gate C2).
- ✅ **Sentry validated (sanitized)** — only a generic `"Creative job failed: <CODE>"` + 7 technical
  tags; no URL/secret/PII, size-capped (Gate C1 + C2 fix).
- ✅ **Provenance / QA / immutability** — versioned immutable Assets, full provenance, ffprobe QA
  before Asset creation, content sha256 (Gate B2/C1/C2). QA runs **inside the render Sandbox**
  (`SandboxRemotionProvider.render`, `src/lib/video-engine/render-provider.ts`) — ffprobe is
  captured there, right after `renderMedia`, before the Sandbox stops; `worker-deps.ts`'s
  `defaultRunQa` only parses that JSON (`qa.ts`'s pure `parseFfprobe`). No host ffprobe binary is
  needed on the worker's own runtime.
- ✅ **Idempotent migration** — safe to re-run; RLS/indexes correct (Gate A/C1).

## Product integration (connects the platform to the product) — Gate D1
- ✅ **Real route → worker → Sandbox → Storage → Asset wired in code** — the worker's `produce`/
  `reconcile` (previously stubbed) now call the real `produceVideoAsset` + `SandboxRemotionProvider`
  + `SupabaseVideoStoragePort`/`SupabaseAssetStore` via `src/lib/video-engine/worker-deps.ts`
  (unit-tested against fakes; no real Sandbox run yet — that's the remaining owner-gated step
  below, same shape as C2's fixture render but now with the actual render/QA path).
- ✅ **Feature flags** — `CREATIVE_STUDIO_VIDEO_ENABLED` (route) + `CRON_SECRET` (worker); both
  fail-closed; both still unset in every environment as of this writing, so nothing above is
  reachable yet (see the worker route's header comment).
- ✅ **Sentry init wired** — repo-root `instrumentation.ts` initializes `@sentry/nextjs` and
  registers it with `capturePipelineError`'s fallback, gated on `SENTRY_DSN`; no-ops (never
  throws) while the DSN is unset. **Provisioning the DSN itself is still an owner action.**
- ✅ **Metrics / observability wired** — the separated `RenderMetrics` (+ cost/provider) persist
  onto the `completed` transition's `metadata` jsonb (`pipeline.ts`); `getJobTimeline`
  (`src/lib/creative-jobs/timeline.ts`) is the admin-only read of one job's ordered transitions.
  DB log remains the source of truth; no separate metrics store, no PostHog.
- ✅ **Real end-to-end validation** — the full single flow (Route → Worker → real Sandbox → real
  Remotion → real in-sandbox ffprobe QA → real Supabase Storage → real Asset → transitions →
  exactly-once) ran green (6/6) against real local Supabase + real Sandbox. **This run caught a real
  crash-recovery duplication bug** (route wasn't stamping `traceId`) — fixed in `7572ffd`; re-run PASS.
  See `2026-07-16-gate-d1-e2e-verdict.md`.
- ⏳ **Technical rollout** — flag-gated, no seller exposure. Pending only the owner actions below
  (migration to prod, private prod bucket, flags/DSN, **prebuilt Sandbox base artifact**).

## Seller experience — Gate D2 (built 2026-07-17, owner design + copy approved)
- ✅ **"Listing video"** panel (title "Listing video", subtitle "Create a polished video using your
  listing photos", primary action "Create listing video") mounted in the seller **dashboard** per
  listing, after `MediaStrategyPanel` — never onboarding Step 5. Server-flag-gated
  (`CREATIVE_STUDIO_VIDEO_ENABLED`, no NEXT_PUBLIC_ variant). `src/components/listing-video-panel.tsx`
  + `src/app/[lang]/dashboard/page.tsx` mount (commits `c0f6c34..631fb2e`).
- ✅ **Exactly four seller-facing states** — idle / creating / completed / failed — mapped from the 8
  internal job states by the pure `mapJobStateToSeller` (`src/lib/creative-studio/seller-video-status.ts`,
  15 unit tests). No internal term (`rendering`/`qa`/`uploading`/`queue`/`%`) reaches the UI.
- ✅ **Read-only status route** `GET /api/creative-studio/video/status` — flag-gated 404, 401 auth,
  explicit-ownership 403, returns a leak-free DTO + (when completed) short-lived signed preview/download
  URLs; a completed job whose asset can't yet be signed degrades to "creating", never 500
  (`route.ts`, 11 unit tests incl. a no-leak substring assertion).
- ✅ **Skeleton-first, no misleading flash** — before the first status resolves the panel shows a
  stable-height skeleton with NO create button (prevents premature duplicate generation); preview
  before download (poster/Preview plays inline, Download is separate); visibility-aware polling
  (pauses on hidden, resumes on return, stops on terminal, never POSTs, survives refresh); reassuring
  error copy ("Your listing and photos are safe. No video was added."); AA (focus rings, aria-live,
  motion-reduce); mobile-responsive; EN/ES parity.
- ✅ **Visual validation (Gate D2-7)** — the real component rendered through all 5 seller-visible
  states (idle/creating/completed/failed/skeleton) at desktop (1200px) and mobile (390px) widths in
  EN and ES, via a throwaway fetch-stubbed harness (untracked, deleted after; production/infra
  untouched). Meta line renders `Created Jul 16, 2026 · 0:17 · 1080p` (EN) / `Creado el 16 jul 2026 · …`
  (ES, Intl-localized). Awaiting owner review before any deploy/flag activation.

## Launch-prep checklist (owner-defined, 2026-07-17) — the ONLY remaining work; each is a gated owner action
This is no longer Creative Studio development. Do NOT add features. Complete these, then STOP again before any deploy.
- ◻ **Feature flag** — set `CREATIVE_STUDIO_VIDEO_ENABLED=true` (staged: owner-only first).
- ◻ **Migration** — apply `creative_studio_video` to production (`supabase db push`, signed off).
- ◻ **Storage** — create the private production `creative-studio` bucket.
- ◻ **Sandbox artifact** — build/pin the prebuilt render base artifact; set `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID`/`_IMAGE`.
- ◻ **Sentry DSN** — provision + set `SENTRY_DSN` (sanitized events already wired).
- ◻ **Analytics** — decide + wire product analytics (none today; DB transition log is the current source of truth).
- ◻ **Rollback** — confirm instant-disable (unset flag → 404 / unset `CRON_SECRET` → worker stops) + documented schema rollback SQL.
- ◻ **Smoke test** — one flag-on render in staging, reviewable + downloadable.
- ◻ **First beta listing** — one real seller listing in a controlled private beta.
- ◻ **First production render** — one real production job renders, is reviewable, and cost is within budget.

## Owner actions (required before any real activation)
- ◻ Apply the `creative_studio_video` migration to **production** (`supabase db push`, signed off).
- ◻ Create the **private** production `creative-studio` Storage bucket.
- ◻ Set `CREATIVE_STUDIO_VIDEO_ENABLED`, `CRON_SECRET`, `SENTRY_DSN`, Vercel Sandbox access on Vercel (Pro).
- ◻ Build/pin the **prebuilt render artifact** (Node24 + Chromium libs + ffmpeg/ffprobe + xz + pinned
  Remotion) so per-job has no npm install (Gate B2 requirement); set
  `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID` (or `_IMAGE`) once baked — the worker throws loudly
  (`MissingSandboxBaseArtifactError`) rather than falling back to a stock runtime until this is set.

## Rollback
- ◻ Instant disable: unset `CREATIVE_STUDIO_VIDEO_ENABLED` (route 404s) and/or `CRON_SECRET` (worker
  stops claiming). In-flight jobs recovered/failed by the sweep.
- ◻ Schema rollback SQL documented (activation runbook).

## Launch criteria (go/no-go)
- ◻ All Gate D1 + D2 items ✅.
- ◻ One real production job renders + is reviewable + downloadable (staged, flag on for owner only).
- ◻ Cost per video confirmed within budget on the prebuilt artifact.
- ◻ Sentry receiving sanitized events; DB transition log queryable.
- ◻ Explicit owner go/no-go.

## Out of scope for P2 launch (deferred)
Auto-publish/Distribution, Veo/generative video, credits/Cost-Engine soft override, Tour Engine (3D),
multi-format generation, the full Studio "what do you want to create?" surface.

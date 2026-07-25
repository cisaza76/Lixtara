# Creative Studio v1 — Production Activation Runbook

**Scope:** Turn on the flag-gated "Listing video" feature in production, staged owner-only → controlled beta.
**Status of the code:** frozen. Branch `docs/media-program-master-plan`, not merged. Everything below is an
**owner action** (infrastructure / secrets / sign-off) — no code change is required to activate.
**Golden rule:** the two flags (`CREATIVE_STUDIO_VIDEO_ENABLED`, `CRON_SECRET`) are the master switches.
While either is unset, the feature is inert: the enqueue route 404s and the worker 401s, so no job is ever
queued or processed.

> Do the steps **in order**. Each step has **Do → Verify → Rollback**. Do not proceed to the next step until
> Verify passes. Keep the flag OFF until Step 8; nothing seller-visible turns on before then.

---

## Preconditions (confirm before Step 1)
- [ ] The branch is merged to the deploy branch (or you are deploying this branch to a **staging** Vercel env first).
- [ ] Vercel plan supports **Fluid Compute** + **Vercel Sandbox** (Pro) and Sandbox access is enabled for the project.
- [ ] Supabase CLI is authenticated for prod (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` in local `.env.local`, gitignored).
- [ ] You have owner sign-off to touch the production DB (`fizhoufepowilbhbtfkg`).

---

## Step 1 — Apply the migration (schema)
**Do:** From the repo root, with the CLI linked to prod:
```
supabase db push        # applies supabase/migrations/20260715171914_creative_studio_video.sql
```
This creates `assets`, `creative_jobs`, `creative_job_transitions` (idempotent; RLS seller-read-only; indexes incl.
the partial-unique `creative_jobs_idempotency_active`).
**Verify:**
```
-- via psql or the SQL editor
select tablename from pg_tables where schemaname='public'
  and tablename in ('assets','creative_jobs','creative_job_transitions');   -- expect 3 rows
select count(*) from pg_policies where tablename in ('assets','creative_jobs','creative_job_transitions'); -- >0, RLS on
```
The migration is idempotent — safe to re-run if interrupted.
**Rollback:** Drop the three tables in dependency order (transitions → jobs → assets). Keep the rollback SQL in
this repo before you run push:
```
drop table if exists public.creative_job_transitions cascade;
drop table if exists public.creative_jobs cascade;
drop table if exists public.assets cascade;
```
(Only safe while the feature has never been live and no rows exist. Once beta rows exist, prefer disabling via the
flag — Step 8 rollback — over dropping tables.)

---

## Step 2 — Create the private Storage bucket
**Do:** Create a bucket named **`creative-studio`**, **private** (`public = false`). (Override the name only if you
also set `CREATIVE_STUDIO_BUCKET_NAME` to match — default is `creative-studio`.)
**Verify:** In Supabase Storage, the bucket exists and is **not public**. Object paths will be UUID-only
(`{listingId}/video/{traceId}.mp4`) — no PII in paths by design.
**Rollback:** Delete the bucket (only before any real render; otherwise empty it).

---

## Step 3 — Build & pin the Sandbox render artifact
This is the longest-lead item. The worker **refuses to run** without it (throws `MissingSandboxBaseArtifactError`).
**Do:** Build a Vercel Sandbox base image containing: Node 24, Chromium runtime libs, `ffmpeg` **and `ffprobe`**,
`xz` (needed to unpack the static ffmpeg), and the **exact-pinned** Remotion packages
(`@remotion/bundler`/`@remotion/renderer`/`@remotion/fonts`, no caret). Publish/snapshot it, then set **one** of:
```
CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID=<snapshot id>     # preferred
# or
CREATIVE_STUDIO_SANDBOX_IMAGE=<image ref>
```
**Verify:** The env var is set in the target Vercel environment. (Full verification happens at the Step 9 smoke test —
a real render either succeeds inside this artifact or the worker fails loudly; there is no silent fallback to a stock
runtime.) Note: `ffprobe` QA runs **inside this Sandbox** right after `renderMedia`; the worker's own Node runtime does
**not** need an `ffprobe` binary (the D1 fix moved QA in-sandbox — the worker route header comment predates that and is
stale on this point).
**Rollback:** Unset the var → the worker throws on the next claim (fails closed, no bad renders). Combined with the
flag being off, nothing is user-visible.

---

## Step 4 — Set the worker cron secret
**Do:** Set `CRON_SECRET` (a strong random value) in the production environment. The cron is already declared in
`vercel.json` (`/api/creative-studio/video/worker`, `*/5 * * * *`). Vercel Cron calls it with
`Authorization: Bearer $CRON_SECRET`.
**Verify:** With the secret set but the feature flag still OFF, hit the worker manually:
```
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<prod>/api/creative-studio/video/worker
# expect 200 {"claimed":0,"processed":0,"recovered":0}  (no jobs queued yet — flag off)
curl -s https://<prod>/api/creative-studio/video/worker            # expect 401 (no secret)
```
**Rollback:** Unset `CRON_SECRET` → the worker 401s on every trigger and claims nothing.

---

## Step 5 — Provision Sentry (error capture)
**Do:** Set `SENTRY_DSN` in production. `instrumentation.ts` initializes `@sentry/nextjs` only when it is set (no-op,
never throws, when unset). Events are **sanitized**: only a generic `"Creative job failed: <CODE>"` message + 7
technical tags — no URL/secret/PII, size-capped.
**Verify:** After the Step 9 smoke test forces one failure (e.g. temporarily point the bucket wrong), confirm exactly
one sanitized event arrives, then revert. If you skip the forced failure, at minimum confirm the DSN is set and the app
boots without Sentry init errors.
**Rollback:** Unset `SENTRY_DSN` → capture silently disabled (DB transition log remains the source of truth).

---

## Step 6 — (Optional now) Analytics wiring
No product analytics exist today; the `creative_job_transitions` table + `getJobTimeline` are the current source of
truth. Analytics is **not required to activate** — it is required to *learn* during beta. Decide the tool and wire the
minimal event set from the Beta Playbook (`create_click`, `completed`, `preview_click`, `download_click`, `retry`,
`error`, plus panel impressions). If deferring, rely on DB queries for the first 5-listing beta (queries are in the
Beta Playbook).
**Verify / Rollback:** N/A until wired.

---

## Step 7 — Confirm conservative worker tuning (defaults are fine)
The worker's batch/heartbeat/timeout are env-overridable but ship with conservative defaults. Only set these if you
have a specific reason:
`CREATIVE_VIDEO_MAX_JOBS_PER_RUN`, `CREATIVE_VIDEO_MAX_CONCURRENCY`, `CREATIVE_VIDEO_JOB_TIMEOUT_MS`,
`CREATIVE_VIDEO_HEARTBEAT_MS`, `CREATIVE_VIDEO_STALE_AFTER_MS`, `CREATIVE_VIDEO_WORKER_BUDGET_MS`.
**Verify:** Leave unset for beta unless the smoke test shows a reason to change them.

---

## Step 8 — Turn the feature ON (staged: owner-only)
**Do:** Set `CREATIVE_STUDIO_VIDEO_ENABLED=true` in production. This simultaneously:
- un-404s `POST /api/creative-studio/video/generate` and `GET /api/creative-studio/video/status`, and
- mounts the "Listing video" panel in the seller dashboard (server-gated in `dashboard/page.tsx`).
Because there is no per-user gate in code, "owner-only" is achieved by **only the owner having a real listing** during
this step, OR by activating first in a **staging/preview** deployment that only the team can reach. Do not broadcast.
**Verify:** Sign in as the owner, open the dashboard, confirm the panel renders in the **idle** state ("Listing video" /
"Create listing video").
**Rollback (instant kill switch):** Unset `CREATIVE_STUDIO_VIDEO_ENABLED` → route 404s **and** the panel unmounts
immediately. In-flight jobs are recovered or failed by the worker's sweep; no seller sees a broken state.

---

## Step 9 — Smoke test (one real render, owner listing)
**Do:** As the owner, on a real approved listing with enough photos, click **Create listing video**. Watch it move
idle → creating → (≤ a few minutes) → **completed**. Click **Preview video** (plays inline), then **Download video**.
**Verify (UI + ground truth):**
- UI reaches "Your video is ready", preview plays, download works.
- DB: exactly one row and no duplicates —
```
select state, count(*) from creative_jobs where listing_id='<id>' group by state;         -- one completed
select count(*) from assets where listing_id='<id>' and kind='video';                       -- exactly 1
select storage_bucket, storage_path from assets where listing_id='<id>';                    -- private bucket, UUID path
```
- One object exists in the `creative-studio` bucket at that path; QA (ffprobe) ran in-sandbox (h264/1920×1080/30fps).
- Metrics landed on the `completed` transition's `metadata`; Sentry received nothing (success path).
**Force-fail once (recommended):** temporarily break signing or the bucket, retry, confirm the UI shows the **failed**
state ("Your listing and photos are safe. No video was added."), the job is `failed` with a structured `error_code`,
**zero** assets/objects leaked, and Sentry got exactly one sanitized event. Then revert.
**Rollback:** Step 8 kill switch.

---

## Step 10 — Go / No-Go gate
Proceed to the Beta Playbook only if ALL are true:
- [ ] Smoke test render succeeded, was reviewable + downloadable, exactly-once verified by SQL.
- [ ] Force-fail produced the reassuring error state, no leaks, one sanitized Sentry event.
- [ ] Cost per render confirmed within budget on the pinned artifact.
- [ ] Instant rollback (unset flag) verified to hide the panel + 404 the route.
- [ ] Explicit owner **GO**.

If any is false → **No-Go**: unset the flag, fix, re-run from the failing step.

---

## Kill-switch summary (memorize this)
| Lever | Effect | Use when |
|---|---|---|
| unset `CREATIVE_STUDIO_VIDEO_ENABLED` | route 404s + panel unmounts (seller-facing OFF) | anything user-visible looks wrong |
| unset `CRON_SECRET` | worker stops claiming/processing (pipeline OFF) | renders misbehave / cost spike |
| unset Sandbox artifact var | worker fails closed on next claim | bad artifact |
In-flight jobs are always recovered or failed by the sweep — no manual cleanup needed for a clean rollback.

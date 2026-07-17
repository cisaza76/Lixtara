# Gate D1 — real end-to-end validation verdict

**Date:** 2026-07-16
**Environment:** real local Supabase (Postgres + private `creative-studio` Storage) + **real Vercel
Sandbox** (region `iad1`). Real components on the main path — no fakes: real Route → real Worker →
real Sandbox → real Remotion `ListingVideo` render → real in-sandbox ffprobe QA → real local Supabase
Storage → real Asset → real transitions. NEVER production; no deploy/merge/push; no `db push`.

## Stage-by-stage

| Pipeline stage | Result |
|---|---|
| Route (`handleGenerateVideo`) | **PASS** |
| Job (`creative_jobs` + transitions, real Postgres) | **PASS** |
| Worker (`runWorker`/`processJob`, atomic claim, heartbeat) | **PASS** |
| Sandbox (`@vercel/sandbox`, real VM, `stop()` in finally) | **PASS** |
| Render (real `bundle→selectComposition→renderMedia`, real `ListingVideo`) | **PASS** |
| QA (real in-sandbox `ffprobe` + real `parseFfprobe`) | **PASS** |
| Upload (real `SupabaseVideoStoragePort` → private bucket) | **PASS** |
| Asset (real `SupabaseAssetStore`, `kind=video`, `ready_for_review`) | **PASS** |
| Storage (independent re-download + host `ffprobe`: h264/1920×1080/30fps) | **PASS** |
| Timeline (`getJobTimeline`, metrics on `completed` transition) | **PASS** |
| Sentry (only `"Creative job failed: <CODE>"` + 7 tags; no leak) | **PASS** |
| Exactly-once — retry | **PASS** |
| Exactly-once — refresh after completed | **PASS** |
| Exactly-once — **worker restart / cold-restart mid-flight** | **PASS** (after the fix below) |

## END-TO-END: **PASS**

Verified by SQL after the run: **no listing has >1 video Asset** (max = 1), every completed job has a
non-null `trace_id`, and the Asset's `provenance.traceId` equals its job's `trace_id`. Real render
metrics (~17.5s renderMedia on the real composition) landed on the `completed` transition.

## The critical bug this validation caught (and fixed) — why the real E2E mattered

The first E2E run **FAILED** scenario 3 (worker crash mid-flight): the recovered job **re-rendered and
created a duplicate Asset + Storage object** (reproduced twice: 1 → 2 assets). Root cause: the enqueue
route never stamped a `traceId`, so `creative_jobs.trace_id` was `null`; the real `buildRealReconcile`
recognizes a prior render via `job.assetId` (set only on the final `completed` transition) or
`job.traceId` (guarded, skipped when null) — with both absent mid-crash, recovery re-rendered.

Notably, **Gate C2's row-13 test had passed** because it used a hand-rolled reconcile without the
`traceId` guard and always supplied an explicit `traceId` — a combination the real Route +
`buildRealReconcile` never produce. Only wiring the REAL components end-to-end surfaced the gap.

**Fix (`7572ffd`):** the route stamps a stable `crypto.randomUUID()` `traceId` at job creation →
persisted to `creative_jobs.trace_id` → threaded into `produceVideoAsset` → written to
`provenance.traceId` on the Asset. On crash-recovery, `buildRealReconcile` now finds the already-
persisted Asset by `traceId` (even with `assetId` still null) → adopts it → **no re-render, no
duplicate.** Re-run: **6/6 scenarios PASS**, exactly-once holds. This is exactly the class of bug the
owner insisted the single-flow validation would catch.

## Scope note (honest)
The production `SandboxRemotionProvider` requires a **prebuilt base artifact** (owner action, not yet
built) and rejects running without it. This validation therefore used an equivalent **real-render
provider** that installs on-the-fly in a real Sandbox (the Gate B2 approach) — genuinely real render +
real in-sandbox ffprobe. Everything else (route, worker, produce/reconcile orchestration, Storage,
Asset, Jobs, transitions, exactly-once) is the actual production code path. Building/pinning the
prebuilt artifact remains an owner action (production-readiness checklist).

## Confirmation
Local stack only; production Supabase (`fizhoufepowilbhbtfkg`) never reachable; no push/merge/deploy;
no `supabase db push`/`--linked`. Harness under `scripts/d1-e2e/` is gitignored/untracked.

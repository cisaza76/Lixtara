# Gate C2 — Integration validation matrix

**Purpose:** Gate C2 is an **integration validation, not a deployment.** It answers ONE question:
*does the whole integrated system do exactly what the design promises — especially "exactly
once"?* This matrix is the **mandatory checklist**; no scenario may be skipped silently.

**Environment (owner-provided, NOT production):** a **local** Supabase (`supabase start`, needs
Docker) or a **staging** project — migration `20260715151434…creative_studio_video` applied there,
a **private** bucket `creative-studio`, and a valid Vercel Sandbox OIDC token. **Never production.**
No UI, no deploy, no merge, no push.

**Status legend:** `PASS` · `FAIL` · `NOT RUN`.

**RUN 2026-07-16** against a **real local Supabase** (`http://127.0.0.1:54521`, local Postgres
`:54522`, private `creative-studio` bucket), migration applied locally, real adapters
(`SupabaseJobsStore`/`SupabaseAssetStore`/`SupabaseVideoStoragePort`), real local `ffprobe` +
real `parseFfprobe`, fixture MP4 as render output (real render already proven in Gate B2).
Harness: `scripts/c2/integration.test.ts` (local, untracked). **Result: 14/14 PASS, deterministic
across runs.** Ground truth verified directly by SQL (below), not only by the harness.

| # | Scenario | Expected outcome | Status |
|---|---|---|---|
| 1 | **Happy path** | job `completed`; 1 real Asset (`ready_for_review`) + 1 real Storage object; transitions `queued→running→rendering→qa→uploading→completed` | **PASS** |
| 2 | **Retry same request** | same job, same Asset, same object — reconciled via `job.assetId`, no 2nd render | **PASS** |
| 3 | **Duplicate concurrent request** | exactly **one** job (real partial-unique index caught 23505; winner re-queried) | **PASS** |
| 4 | **Worker claims already-claimed job** | B got null (real atomic CAS `UPDATE…WHERE state='queued'`); processed once | **PASS** |
| 5 | **Heartbeat expired + recovery** | 5a: attempts<max → requeued → completed. 5b: past max → `failed`/`timeout`; 0 assets | **PASS** |
| 6 | **Cancellation during execution** | job → `cancelled`; 0 assets/objects past cancel | **PASS** |
| 7 | **QA fail** | `failed` `TECHNICAL_QA_FAILED`; 0 assets/objects (QA before any write) | **PASS** |
| 8 | **Upload fail** | `failed` `STORAGE_UPLOAD_FAILED`; 0 assets/objects | **PASS** |
| 9 | **createAsset fail after real upload** | `failed` `ASSET_CREATE_FAILED`; **uploaded object really removed** (0 objects — no orphan) | **PASS** |
| 10 | **Bucket without permission** | real Storage bucket-not-found error → `failed` `STORAGE_UPLOAD_FAILED` (not silent) | **PASS** |
| 11 | **Expired signed URL** | `failed` `ASSET_DOWNLOAD_FAILED`; 0 assets/objects | **PASS** |
| 12 | **Controlled Sentry event** | Sentry gets only a **generic** `"Creative job failed: <CODE>"` + 7 tags — no URL/secret/address/manifest/stack (size-capped) | **PASS** (after fix) |
| 13 | **Worker death during `uploading` + recovery** | `recoverAbandoned` auto-requeues the stale `uploading` job; reprocess reconciles → `completed`; **still exactly one** Asset + one object | **PASS** (after fix) |

## Findings surfaced by the real run (both fixed — commit `0ba00a2`)
1. **Sentry could leak PII** — the scrubber redacted URLs/secrets but not addresses. Fixed
   structurally: Sentry now receives only a generic code-derived message, never any echoed error
   text, so no PII/URL/secret can reach it. (Row 12)
2. **`recoverAbandoned` didn't cover `qa`/`uploading`** — a worker dying mid-`uploading` was not
   auto-recovered. Fixed: recovery now covers all active non-terminal states; the pipeline's
   reconciliation prevents any duplicate Asset/object on reprocess. (Row 13)

## Ground truth (verified directly via SQL against the local DB/Storage)
- `count(assets kind=video)` = `count(storage.objects in creative-studio)` = **35** → **no orphans**.
- Every `completed` job's listing has **exactly 1** video Asset (min=max=1) → **exactly-once**.
- **0** `failed`-job listings have a leftover Asset/object → failure cleanup holds.
- Bucket `public=false` (private); storage paths are UUID-only (`{listingId}/video/{traceId}.mp4`) — **no PII**.
- A completed job's transition chain is exactly `running→rendering→qa→uploading→completed` (realigned order).
- Failure rows recorded the correct structured `error_code`s (`TECHNICAL_QA_FAILED`,
  `STORAGE_UPLOAD_FAILED`, `ASSET_CREATE_FAILED`, `ASSET_DOWNLOAD_FAILED`, `timeout`).

## The central guarantee — EXACTLY ONCE

The single most important thing Gate C2 must prove (must be `PASS` on rows 2, 3, 4, 13):

```
POST → Job created → Worker A claims → Worker B tries → cannot → render → upload → Asset → completed
then Retry → NO new Asset → NO new object → NO new Job → completed
then Worker-death mid-upload → recovery → completed → STILL one Asset, one object
```

A single request must **never** produce two Assets, two Storage objects, or two completed jobs.

## Verification method per row

Query the real DB/Storage after each scenario: `count(assets where …)`, `count(creative_jobs
where idempotency_key=…)`, list Storage objects under the asset path, and read the
`creative_job_transitions` chain. Cleanup/orphan rows (7,8,9,13) verified by confirming **no**
leftover Storage object and **no** partial Asset row.

## Final verdict

- **Overall: PASS** — 14/14 scenarios, deterministic, against real local Supabase DB + Storage.
- **Exactly-once guarantee: PASS** — a single request never produced two Assets, two Storage
  objects, or two completed jobs (verified for retry, duplicate-enqueue, claim-race, and
  worker-death-during-upload; asset/object/job counts each exactly 1, and no orphans across 35
  produced assets/objects).
- **Two real gaps found and fixed** during the run (Sentry PII, `recoverAbandoned` coverage) —
  exactly the value of running the integration for real.
- **No ADR change needed** — the render-target and architecture decisions hold; C2 confirms the
  distributed-consistency layer.
- **Production untouched:** ran only against the local stack; migration NOT pushed to production;
  no deploy/merge/push/UI. Local repo hacks (config ports, migration ordering) were reverted, not
  committed.

**Remaining (not part of C2):** the enqueue route + worker + real `produce`/`reconcile` wiring
into the Vercel Sandbox render (the harness stubbed the render with a fixture MP4; the real Sandbox
render is separately proven in Gate B2) — that end-to-end wiring + Sentry DSN + the seller UI are
later tasks (Task 7/8), pending authorization.

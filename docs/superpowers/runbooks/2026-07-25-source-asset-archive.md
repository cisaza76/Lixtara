# Source Asset Archive — Manual Execution Runbook (F4.6 Stage E)

**Scope:** manual, operator-driven archiving of Source Video orphans via
`pnpm archive:source-retention`, plus verification and restore-by-runId.
**Status:** code frozen on the F4.6 branch (Stages A–E implemented, NOT merged); Stage C
migrations authored, NOT applied. Nothing here runs automatically — no cron, scheduler,
endpoint, UI, or GC exists.
**Golden rule:** *Archive is SOFT delete.* It sets `lifecycle='archived'` + `archived_at` and
emits one audit event. It never deletes rows, Storage objects, metadata, or `activity_log`.
Reported bytes are **marked archived / reclaimable by a future GC** — never physically freed.

Related: `docs/adr/0009-asset-retention-and-cleanup.md` (policy + single authority),
`docs/adr/0008-temporary-media-access.md` (playback access, unaffected by archive),
`docs/superpowers/plans/2026-07-23-f4.6-asset-archive-design.md` (design, Stages A–E).

---

## A. Purpose and vocabulary

- **What Archive does:** for each listing, flips the engine's *fresh orphans* to
  `lifecycle='archived'` (+`archived_at`) through one guarded conditional UPDATE per asset, and
  records one `creative_studio.source_asset_archived` event per flip in `activity_log`.
- **What it does NOT do:** it never deletes anything, never touches Storage, never changes the
  current source, never mutates `activity_log`, never runs unattended.
- **Eligible assets:** `kind='video' AND source_type='seller_upload'`, scoped to the listing's
  owner. Nothing else is ever considered.
- **current:** the listing's vigente Source Video as decided EXCLUSIVELY by
  `resolveVideoSource` (newest eligible upload). The engine and runner consume this decision;
  nothing recomputes it. The current is never archived (guarded in the SQL WHERE).
- **K (`RETENTION_K = 3`):** how many non-current *active* sources are kept as history.
- **retained:** the K most-recent active non-current sources. Kept.
- **fresh orphan:** active non-current sources beyond K. These are the ONLY archive candidates.
- **alreadyArchived:** non-current sources a PRIOR run archived. Reported for visibility; never
  re-archived, never counted in reclaimable bytes.
- **unresolvedCurrent:** a listing where `resolveVideoSource` returned null despite eligible
  assets existing. Inconsistent state → zero commands for that listing; investigate.

## B. Preconditions (confirm ALL before any run)

1. Stage C migrations applied (`archived_at` + both partial indexes) — verify via
   `supabase migration list` / the Phase-2 checklist below. Until then, apply is impossible
   (the UPDATE would fail on `archived_at`) — do not attempt.
2. `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` present in `.env.local` (service role;
   RLS gives sellers read-only access to `assets`, so only the service client can flip).
3. Environment confirmed out loud: you know WHICH project ref you point at.
4. Operator identified (name in the evidence log — activity_log carries the owner, not you).
5. `runId` chosen (explicit `--run-id` recommended for planned windows), `reason` chosen,
   scope chosen (`--listing <id>` for anything first-time).
6. A dry-run JSON for the same scope has been produced, reviewed, and SAVED.
7. No open incident touching Creative Studio / assets / Supabase.

## C. Mandatory sequence (never jump straight to apply)

1. Confirm environment (project ref, env vars, branch/commit SHA).
2. Run the **dry-run** for your scope.
3. Save the JSON report (`--json > evidence/<runId>-dryrun.json`).
4. Review `listingsUnresolved` — any unresolved target listing → STOP (investigate first).
5. Review the planned assets per listing (`listings[].orphans`) — do they look right?
6. Review `reclaimableBytes` (estimated bytes to be *marked* archived).
7. Review each listing's `current` in the report — sanity-check against expectations.
8. Obtain explicit human approval (owner or delegated operator) for that exact plan.
9. Run **apply** with the SAME scope, `--run-id`, and `--reason` as the reviewed dry-run.
10. Save the apply JSON report (`evidence/<runId>-apply.json`).
11. Run the post-apply verification queries (`verify-source-archive.sql`, same directory).
12. Review `activity_log` counts vs the report's `archived` count (Q2/Q10).
13. Document the result in the evidence log (section E).

## D. Commands (placeholders in `<...>`; never paste secrets)

```bash
# Dry-run — whole universe (read-only, safe by default)
pnpm archive:source-retention

# Dry-run — one listing
pnpm archive:source-retention -- --listing <listingId>

# Dry-run — JSON evidence
pnpm archive:source-retention -- --listing <listingId> --json > evidence/<runId>-dryrun.json

# APPLY — one listing (explicit scope required; start here, never global first)
pnpm archive:source-retention -- --apply --listing <listingId> --run-id <runId> --reason <reason>

# APPLY — global (double opt-in; only after per-listing + small-batch validation)
pnpm archive:source-retention -- --apply --all --confirm-all --run-id <runId> --reason <reason>
```

Defaults: no flags → dry-run over everything; `reason` defaults to `source_retention_manual`;
`runId` auto-generates as `run-<uuid>` when not given. Aborts (exit 1, zero writes): `--apply`
without scope · `--apply --all` without `--confirm-all` · `--listing`+`--all` · unknown flag ·
empty `--run-id`/`--reason` · unknown listing · unresolved `--listing` target.

## E. Evidence to preserve (per run — commit to the ops log, not to git secrets)

Command executed · timestamp · operator · environment/project ref · commit SHA · runId ·
reason · scope · dry-run JSON · apply JSON · pre-apply query results · post-apply query
results · incidents/errors observed · final decision (including "aborted because …").

---

## Verification queries

`verify-source-archive.sql` (this directory) — 12 READ-ONLY queries, parameterized with
`\set runid '<runId>'`:

- **Pre-apply (preflight):** Q3 (no duplicate audits), Q4 (no archived-without-audit debt),
  Q6/Q7 (`archived_at` ↔ lifecycle coherent), Q9 (no archived current — invariant).
- **Post-apply:** Q1 (exact rows archived by the run), Q2+Q10 (audit count == report
  `archived`), Q5 (audit vs state), Q8 (owner/listing coherence), Q11 (hard-delete detector,
  expect 0), Q12 (Storage objects still present, expect 0 missing).

Never run them outside this runbook's procedure; never against a database you haven't
identified in step C.1.

## Restore / rollback by runId

Procedure: `restore-source-archive-by-runid.sql` (this directory). **Decision: manual
transactional SQL** (repo precedent: `rollback-20260715171914_creative_studio_video.sql`), not
a restore runner — smallest, fully auditable, zero new code paths.

Guarantees encoded in the script:

- Operates ONLY on the audit evidence of ONE explicit `runId` (`runId` is the authoritative
  identifier; no time ranges). Requires its own `restoreRunId` + `restoreReason`.
- Three gates: `BEGIN` transaction · inert UPDATE until `\set confirm RESTORE-CONFIRMED` ·
  ends in `ROLLBACK` by default (COMMIT must be consciously enabled after in-transaction
  verification).
- Preview first: every event is listed as `ELIGIBLE` or `EXCLUDED: <reason>` (missing/invalid
  `prevLifecycle`, asset missing → ESCALATE, owner/listing mismatch → ESCALATE, no longer
  archived, `archived_at` differs from the event = modified after archive, duplicate event).
  Excluded rows are skipped, never forced. `prevLifecycle` is never inferred.
- Restores EXCLUSIVELY to the event's `prevLifecycle` and clears `archived_at`. Storage
  untouched. The original archive events are preserved untouched.
- Emits `creative_studio.source_asset_restored` per restored asset (same transaction) with
  `assetId, listingId, ownerId, sourceArchiveRunId, restoreRunId, restoredLifecycle,
  restoredAt, reason`. `user_id` carries the asset owner (same convention as the archive
  event); the OPERATOR is recorded in the evidence log — no fictitious DB identity.
- After restore, **`resolveVideoSource` re-decides current under its normal rules** — the
  script never forces a current.
- **Pending decision (documented, stopped for review):** a partial-unique index for
  `source_asset_restored` events (mirroring the archive one) would require a NEW migration —
  out of Stage E scope. Until decided, restore idempotency relies on the transactional manual
  procedure + preview.

## Observability (existing infrastructure only — no new providers)

Per-run signals — all already emitted by the runner (console + JSON report; this section adds
none): `mode, runId, reason, scope, listingsExamined, listingsResolved, listingsUnresolved,
commandsPlanned, archived, already_archived, skipped_current, not_found_or_not_owner, errors,
reclaimableBytes (estimated, soft-delete), duration (finishedAt − startedAt), exitCode`.
Correlation: `runId` appears in the report, in every `ArchiveCommand`, and in every
`activity_log` row (`metadata->>'runId'`). Logging verified: no secrets printed; mode banner,
runId, scope, counts, and per-asset errors all present. Sentry exists in the repo but is wired
only for the video-render pipeline (`SENTRY_DSN` unset everywhere) — NOT extended here.

**Alert signals (investigate before/instead of continuing):**

| Signal | Meaning |
|---|---|
| `listingsUnresolved > 0` | authority returned null with assets present — inconsistency |
| `skipped_current > 0` | a plan tried to archive a current — INVARIANT ALARM (escalate) |
| `not_found_or_not_owner > 0` | plan/database drift — stale plan or wrong environment |
| `errors > 0` | real failures — exit 1; inspect per-asset errors |
| `commandsPlanned = 0` when work was expected | wrong scope/environment or already archived |
| audit count ≠ archived count (Q2 vs report) | crash window — re-run converges/repairs |
| archived asset without `archived_at` (Q6) | flip invariant broken — escalate |
| archived current (Q9) | escalate immediately |
| apply without a saved dry-run report | procedure violation — stop, document |
| runId reused with a different scope | correlation poisoned — new runId, document |

## Operating criteria

**Abort before apply** when ANY of: environment uncertain · migrations missing · credentials
missing · dry-run not reviewed/saved · scope ≠ reviewed scope · runId/reason ≠ reviewed ones ·
unexpected assets in the plan · unresolved affecting the target listing · a current looks
wrong · any preflight query (Q3/Q4/Q6/Q7/Q9) returns rows · an open related incident exists.

**Continue with partial results** when: an independent asset errors (batch records `error` and
continues; final exit 1) · `already_archived` appears from an idempotent retry (NOT an error) ·
an independent listing is unresolved under `--all` (reported, skipped).

**Escalate** (stop everything, owner review) when: a current was archived · audit absent after
retries · audit duplicated (Q3) · owner/listing mismatch (Q8) · `archived_at` inconsistent
(Q6/Q7 or restore preview) · restore cannot determine `prevLifecycle` · evidence of hard
delete (Q11) or Storage change (Q12) · any unauthorized execution.

## Production readiness checklist (documented ONLY — execute nothing now)

**Phase 1 — Preparation:** branch/commit identified and reviewed · recovery strategy confirmed
(restore-by-runId tested on a scratch dataset if possible) · env vars verified · migrations
reviewed · `supabase db push --dry-run` clean (4 pending as of 2026-07-25) · ops window agreed.

**Phase 2 — Infrastructure (owner sign-off, in order):** apply pending migrations
(`assets_source_selection_index` → `activity_log_video_source_uploaded_unique` →
`assets_archived_at` → `activity_log_source_asset_archived_unique`) · verify schema
(`archived_at` exists) · verify the three indexes · verify migration history · verify the
`activity_log` partial-unique constraint · verify the service client connects.

**Phase 3 — Read-only validation:** global dry-run · dry-run on a test listing · JSON saved ·
unresolved reviewed · currents reviewed · reclaimable bytes reviewed.

**Phase 4 — Controlled apply:** ONE listing · explicit `--run-id` · apply · verify the asset
rows (Q1) · verify `activity_log` (Q2/Q10) · verify the report · watch for errors.

**Phase 5 — Gradual expansion:** small set of listings → re-validate → only then
`--apply --all --confirm-all` → post-run monitoring (all alert signals above).

**Phase 6 — Close:** save all evidence · record the outcome · document anomalies · decide
whether a future GC stage (physical deletion) proceeds — explicitly OUT of F4.6's scope.

## Current limits (honest boundaries)

- Manual only: no cron/scheduler/endpoint/UI — by design at this stage.
- Archive ≠ deletion: Storage keeps every byte until a future, separate, explicitly-approved GC.
- `prevLifecycle` for seller sources is invariantly `draft` today; the audit still records it
  per-asset so restore never assumes.
- The restore-audit idempotency index is a documented pending decision (see above).
- Verification Q9/Q12 are read-only *mirrors* (selection rule / Storage listing) for evidence —
  the authorities remain `resolveVideoSource` and the Storage API.

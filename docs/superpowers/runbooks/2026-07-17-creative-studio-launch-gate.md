# Creative Studio v1 — Launch Gate

**Phase:** not development. Activation only, executed via the Production Runbook one step at a time.
**Three possible outcomes at every checkpoint:**
- **BLOCKED** — a required owner action or critical dependency is outstanding.
- **NO-GO** — a verification or smoke test failed.
- **GO — Cohort 1** — five listings, manual follow-up, kill switch armed.

**No code or UX changes until the runbook is executed.** v1 is frozen.

---

## Current verdict: **BLOCKED**

### Current blocker (the ONLY thing stopping advance right now)
- **Migration history reconciliation.** Step 1's `db push --dry-run` (2026-07-17) showed a bare push would apply an
  older, unauthorized second migration from another workstream (`20260703232736_create_media_agent_jobs.sql`, Media
  Agent) alongside the Creative Studio one. Resolving that cross-workstream collision is out of scope for this launch;
  it has its own checkpoint: **`2026-07-17-migration-reconciliation-checkpoint.md`**. Step 1 stays BLOCKED until a
  dry-run shows exclusively authorized migrations in a clean, in-order history.
  - Step 1 authorization was given by the owner (conditionally) but was **NOT executed** — the pre-flight caught the
    collision first. No SQL applied, no `migration repair`, production intact.

### Prerequisites for GO (future dependencies — do NOT block Step 1; needed later)
| Prereq | Owner action | Gates |
|---|---|---|
| **Sandbox render artifact** (highest-lead; no beta while pending / dynamic-install-dependent) | Build + pin base image; set `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID`/`_IMAGE` (Step 3) | any real render (Step 9) → GO |
| **Code deployed to prod** (branch not merged/deployed; note: neither pending migration is on `main`) | Merge/deploy to prod (or staging) Vercel env | flag-on (Step 8) |
| Private `creative-studio` bucket (Step 2) | create it | Step 9 |
| `CRON_SECRET` / `SENTRY_DSN` (Steps 4–5) | set secrets | worker / capture |
| `CREATIVE_STUDIO_VIDEO_ENABLED` (Step 8) | set flag, staged | seller-visible |

While BLOCKED, nothing is seller-visible and there is zero production risk (both feature flags unset, no migration applied).

---

## Per-step status (Production Runbook)
| Step | What | Status |
|---|---|---|
| — | Migration validated (`migrations:check` ✓) | ✅ agent-verified |
| — | Rollback SQL captured in repo (`rollback-20260715171914_creative_studio_video.sql`) | ✅ agent-verified |
| 1 | Apply migration to prod | ⛔ **BLOCKED / NOT EXECUTED** — pre-flight dry-run found an unauthorized 2nd migration; see migration-reconciliation-checkpoint |
| 2 | Private `creative-studio` bucket | ◻ owner action |
| 3 | Sandbox artifact (B1) | ◻ owner action — **highest dependency** |
| 4 | `CRON_SECRET` | ◻ owner action |
| 5 | `SENTRY_DSN` | ◻ owner action |
| 6 | Analytics (optional to activate) | ◻ decision |
| 7 | Worker tuning (defaults fine) | ◻ leave default |
| 8 | Flag ON (owner-only/staging) | ◻ owner action (needs B2) |
| 9 | Smoke test (real render + force-fail) | ◻ needs Steps 1–8 |
| 10 | Go / No-Go | ◻ |

---

## Rule of advance
Do the steps in order, no jumps. Validate each step's **rollback** before advancing. The agent (Claude) may run all
**read-only verification** (SQL checks, `migrations:check`, log/Sentry inspection) and prepare exact commands, but does
**not** autonomously run `supabase db push`, create buckets, set secrets, deploy, or flip the flag — those are owner
actions with sign-off. After each owner action, the agent verifies the result before the next step opens.

**To move off BLOCKED:** resolve the **migration reconciliation checkpoint**
(`2026-07-17-migration-reconciliation-checkpoint.md`) — decide the fate of `create_media_agent_jobs`, then confirm a
`db push --dry-run` shows only authorized migrations in order. Only then does Step 1 reopen. Prerequisites (artifact,
deploy, bucket, secrets, flag) can proceed in parallel but none may be executed until Step 1 closes GO.

**Do NOT advance to Step 2 (bucket) or any later step** until a `supabase db push --dry-run` shows exclusively expressly
authorized migrations, or a complete formally-approved set. This pause is not a regression — it prevented operational
debt right before launch.

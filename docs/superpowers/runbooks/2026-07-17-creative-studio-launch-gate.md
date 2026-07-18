# Creative Studio v1 — Launch Gate

**Phase:** not development. Activation only, executed via the Production Runbook one step at a time.
**Three possible outcomes at every checkpoint:**
- **BLOCKED** — a required owner action or critical dependency is outstanding.
- **NO-GO** — a verification or smoke test failed.
- **GO — Cohort 1** — five listings, manual follow-up, kill switch armed.

**No code or UX changes until the runbook is executed.** v1 is frozen.

---

## Current verdict: **BLOCKED — Documentation complete; production artifact not yet baked**

### Current blocker (the ONLY thing stopping advance right now)
- **Sandbox render artifact bake (preflight Step 0).** The artifact **definition is validated** (recipe, versions,
  reproducibility, compatibility, security, integration, rollback, acceptance criteria) — see
  **`2026-07-18-creative-studio-sandbox-artifact.md`** + `bake-sandbox-base.mjs`. Two mandatory items must close
  **before** the first real bake is authorized:
  1. **Pin ffmpeg** — exact version + immutable URL + SHA-256 set and enforced fail-closed (no "latest").
  2. **Confirm React 19.2.4 in the bake** — the artifact is aligned to the app's React 19.2.4 (was 18.3.1 in the
     spike); confirm a real render in the baked artifact.
  Only then is the actual bake (create Sandbox → `snapshot()` → record `snapshotId` → bump `BASE_ARTIFACT_VERSION` →
  set env var) authorized. No bake, upload, bucket, secret, flag, cron, or migration has been done.

### Resolved (no longer blockers)
- **Migration history reconciliation — RESOLVED** via workstream separation (topology ii). F
  (`feat/media-intelligence-foundation`) and B (`feat/creative-studio`) are **merged to `main`** (`main` = `8d9b641`);
  A (`feat/media-agent-app`, carries `create_media_agent_jobs`) is deliberately **not** merged. `supabase db push
  --dry-run` from `main` now shows **exclusively** `20260715171914_creative_studio_video.sql`, in order. See
  `2026-07-17-migration-reconciliation-checkpoint.md`.
- **Code integrated to `main`** — Creative Studio v1 is on `main` but **inert** (feature flags unset, migration
  not applied).

### Prerequisites for GO (owner-gated; sequence after the artifact)
| Prereq | Owner action | Gates |
|---|---|---|
| **Sandbox render artifact** (current focus) | Close ffmpeg-pin + React-19 confirm → bake → set `CREATIVE_STUDIO_SANDBOX_SNAPSHOT_ID`/`_IMAGE` + bump `BASE_ARTIFACT_VERSION` (Step 3) | any real render (Step 9) → GO |
| **Migration applied** | `supabase db push` (signed off; dry-run from `main` = only the CS migration) | Step 9 |
| Private `creative-studio` bucket (Step 2) | create it | Step 9 |
| `CRON_SECRET` / `SENTRY_DSN` (Steps 4–5) | set secrets | worker / capture |
| `CREATIVE_STUDIO_VIDEO_ENABLED` (Step 8) | set flag, staged | seller-visible |

While BLOCKED, nothing is seller-visible and there is zero production risk (feature flags unset, migration not applied).

---

## Per-step status (Production Runbook)
| Step | What | Status |
|---|---|---|
| — | Migration validated (`migrations:check` ✓) | ✅ agent-verified |
| — | Rollback SQL captured in repo (`rollback-20260715171914_creative_studio_video.sql`) | ✅ agent-verified |
| 0 | **Sandbox artifact definition** (recipe/versions/reproducibility/security/rollback/acceptance) | ✅ **validated** (preflight, 2026-07-17) — bake NOT authorized; see `2026-07-18-creative-studio-sandbox-artifact.md` |
| 1 | Apply migration to prod | ◻ **unblocked, not executed** — reconciliation resolved (F+B on `main`); dry-run from `main` = only the CS migration; needs owner sign-off + after the artifact |
| 2 | Private `creative-studio` bucket | ◻ owner action |
| 3 | Sandbox artifact **bake** (create → snapshot → set env + bump `BASE_ARTIFACT_VERSION`) | ◻ owner action — **highest dependency; blocked on ffmpeg-pin + React-19 confirm** |
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

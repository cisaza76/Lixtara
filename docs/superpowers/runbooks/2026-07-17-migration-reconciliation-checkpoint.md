# Migration Reconciliation Checkpoint (opened 2026-07-17)

**Why this exists:** the Creative Studio Launch Gate's Step 1 pre-flight (`supabase db push --dry-run`)
revealed that a bare `db push` from branch `docs/media-program-master-plan` would apply **two** migrations,
not one — a second, older, unauthorized migration from a **different workstream** (Media Agent). Resolving a
cross-workstream history collision inside the Creative Studio launch procedure is out of scope; it gets its own
checkpoint. **Production is untouched. No SQL was applied. No `migration repair` was run.**

## Status
- **Launch Gate: BLOCKED**
- **Step 1 (creative_studio migration): NOT EXECUTED**
- **Current blocker: migration history reconciliation** (this checkpoint)
- **Production: intact** (both feature flags unset; neither migration applied)

## The finding (facts, read-only verified)
`supabase db push --dry-run` (2026-07-17, from `docs/media-program-master-plan`) → *"Would push these migrations"*:
1. `20260703232736_create_media_agent_jobs.sql` — **Media Agent** workstream (PR #81). Creates `public.media_agent_jobs`
   (+2 indexes, RLS, 3 owner policies; FKs to `properties`/`auth.users`). **Not authorized** for this launch.
2. `20260715171914_creative_studio_video.sql` — **Creative Studio** (this launch). Creates `assets` / `creative_jobs` /
   `creative_job_transitions`.

Additional read-only facts:
- **Neither migration is on `main`.** Both exist ONLY on `docs/media-program-master-plan`. The dry-run listed both
  because that branch's `supabase/migrations/` carries both workstreams and neither is in the prod remote history yet.
- **`media_agent_jobs` is referenced by code** on this branch: read in `src/app/[lang]/dashboard/page.tsx:149`
  (`.from("media_agent_jobs")`, gated by `MEDIA_AGENT_ENABLED`), written via `src/lib/media-intelligence/jobs.ts`.
  It is **flag-gated** — inert in prod while `MEDIA_AGENT_ENABLED` is unset (which it is).
- **Ordering:** the Media Agent migration (`20260703…`) is **older** than the Creative Studio one (`20260715…`).
  Applying only the newer and marking it applied would leave an older migration pending → an out-of-order history
  that complicates future standard `db push` runs. (This is exactly why option A of the launch step was rejected.)
- The two tables are **independent** (no FK/logic dependency between `media_agent_jobs` and the Creative Studio tables).

## The question to resolve
How do we reach a state where `supabase db push --dry-run` (from whatever branch we deploy) shows **exclusively
migrations that are expressly authorized, or a complete formally-approved set** — with a clean, in-order history that
keeps future standard pushes working?

## Resolution paths (owner decision — involves the Media Agent workstream owner)
1. **Authorize both for a single push.** Formally review + approve `create_media_agent_jobs` alongside
   `creative_studio_video`, then one ordered `db push` applies both. Clean history, in order. Requires the Media Agent
   owner to sign off on that table going live in prod now (it stays inert behind `MEDIA_AGENT_ENABLED`).
2. **Withdraw/relocate the Media Agent migration** by a decision of its workstream owner (e.g. it moves to its own
   branch/PR and is applied on its own schedule), so the Creative Studio deploy branch carries only its own migration
   and the dry-run then shows exactly one authorized migration.
3. **Consolidated/branch-hygiene procedure.** Since neither migration is on `main`, let each feature merge to `main`
   independently, each with its own migration, and let prod push happen per-merge in timestamp order — documented as
   the standing procedure so future pushes stay ordered and intentional. (This is the lowest-risk, most conventional
   option: no out-of-order applies, no manual repair, each workstream owns its own apply.)

## Recommendation (non-binding — decision is the owner's + Media Agent workstream's)
**Path 3** is the cleanest: it removes the collision at its root (a single branch carrying two workstreams' unmerged
migrations) rather than papering over it, preserves ordering, and needs no `migration repair` or out-of-flow SQL.
Path 1 is fine if the Media Agent table is genuinely wanted live now. Path 2 if the Media Agent work should not ship
with Creative Studio.

## Exit criteria (do NOT advance the Launch Gate past this until ALL hold)
- [ ] A decision on `20260703232736_create_media_agent_jobs.sql` is recorded (authorize / withdraw / per-merge).
- [ ] A `supabase db push --dry-run` from the intended deploy branch shows **only** expressly-authorized migrations
      (either just `creative_studio_video`, or a fully-approved set), in order.
- [ ] The resulting history is confirmed to keep future standard `db push` runs ordered and predictable.
- Only then does Creative Studio Runbook **Step 1** reopen.

## Guardrail
Neither migration should be applied by accident, and none should be skipped via an improvised exception. Any prod apply
remains an explicit, signed-off owner action executed through the normal migration flow — never direct SQL + repair as a
launch-time workaround.

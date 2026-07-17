# Lixtara Creative Studio — Production Activation Runbook

## Purpose

This runbook describes how to safely activate the **Lixtara Creative Studio** (the
consumer-facing product name for the Media Intelligence Agent) in production. It is a P0
prerequisite for turning the feature on for real sellers.

The product/marketing name is **Lixtara Creative Studio**. This is a naming decision only —
none of the code identifiers change:

- Feature flag: `MEDIA_AGENT_ENABLED`
- Database table: `media_agent_jobs`
- API surface: `/api/media-agent/*` (currently `/api/media-agent/generate`)

Do not rename these identifiers as part of activation. Any future rename is a separate,
explicit refactor — not part of turning the feature on.

v1 is mock-only: every deliverable the pipeline produces is a mock render, not real generated
media. Activation makes the mock pipeline reachable in production; it does not turn on real
media generation.

## Fails-closed evidence

The route is gated by a feature flag that fails closed, verified by two test facts in
`src/app/api/media-agent/generate/route.test.ts`:

1. **`isMediaAgentEnabled()` returns `false` unless the env var is exactly `"true"`** — covered
   by the existing `describe("isMediaAgentEnabled")` block. Unset, `"false"`, and any other
   value all evaluate to `false`; only the literal string `"true"` enables it.
2. **`POST` returns `404` with body `{ error: "not_found" }` when the flag is off** — covered
   by the new `describe("POST fails closed")` block, added in this change. It calls the actual
   exported `POST` handler from `src/app/api/media-agent/generate/route.ts` with the flag unset
   and with the flag set to `"false"`, and asserts `status === 404` and
   `{ error: "not_found" }` in both cases.

The flag check is the very first statement inside `POST` (`src/app/api/media-agent/generate/route.ts`,
lines 37-40), before any Supabase client construction, auth call, rate-limit check, or body
parsing:

```ts
export async function POST(req: Request) {
  if (!isMediaAgentEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // ... auth, rate-limit, Supabase, pipeline — all unreachable when the flag is off
```

Because of this ordering, and because the tests exercise the real handler (not a mock of it),
**with `MEDIA_AGENT_ENABLED` unset or not `"true"`, the route is indistinguishable from a route
that does not exist — a 404 — and no mock output, job row, or Supabase call is reachable.**
This holds in every environment (local, preview, production) since it depends only on the
process env var, not on deployment target.

## Migration idempotency + rollback

**File:** `supabase/migrations/20260703232736_create_media_agent_jobs.sql`
**Status: NOT applied to the production database (`fizhoufepowilbhbtfkg`) as of this writing.**

### Idempotency finding

**The migration is idempotent — safe to re-run** (hardened 2026-07-15). Every statement guards
against an already-present object, so a second `supabase db push` is a no-op rather than an
error:

- `create table if not exists public.media_agent_jobs (...)`
- `create index if not exists media_agent_jobs_property_idx ...`
- `create index if not exists media_agent_jobs_owner_idx ...`
- `alter table ... enable row level security;` — already idempotent (enabling twice is a no-op)
- Each policy is `drop policy if exists "…" on public.media_agent_jobs;` **then**
  `create policy "…" …`. Postgres has no `create policy if not exists`, so drop-then-create is
  the idempotent equivalent: a re-run replaces the policy with an identical definition instead
  of erroring.

Re-running the migration yields the **identical** schema and never errors on already-present
objects. Note the one caveat inherent to drop-then-create policies: for the instant between the
`drop` and the `create` inside the transaction, the policy does not exist — this is safe here
because Supabase runs each migration in a single transaction (the drop/create are atomic to
outside readers), and the table is owner-gated by three policies that are all recreated in the
same transaction.

**Pre-apply validation (optional, owner):** before `db push` you may confirm current state with
`\d public.media_agent_jobs` and
`select polname from pg_policies where tablename = 'media_agent_jobs';` — but re-running is now
safe regardless.

### Rollback SQL

If the migration needs to be reverted (before or after `db push`), this drops everything it
creates, in the correct order (policies and indexes are dropped implicitly by `CASCADE` on the
table, but they're listed explicitly here for clarity/audit):

```sql
-- Rollback for 20260703232736_create_media_agent_jobs.sql
drop policy if exists "media_agent_jobs owner select" on public.media_agent_jobs;
drop policy if exists "media_agent_jobs owner insert" on public.media_agent_jobs;
drop policy if exists "media_agent_jobs owner update" on public.media_agent_jobs;

drop index if exists public.media_agent_jobs_property_idx;
drop index if exists public.media_agent_jobs_owner_idx;

drop table if exists public.media_agent_jobs cascade;
```

`media_agent_jobs` has no downstream foreign-key dependents (nothing else references it), so
`cascade` here is a safety net, not a requirement — no other table's rows would be deleted by
this rollback.

## Ordered external activation steps (OWNER-ONLY)

**None of the following steps are agent actions.** They require explicit owner sign-off and
credentials this environment does not have (git push/merge rights, Supabase CLI DB password,
Vercel project access). An agent must not perform them autonomously — this section is a
checklist for Camilo to execute by hand, in order.

1. **Merge PR #81 to `main`.** Confirm the branch is green (`pnpm tsc --noEmit && pnpm lint &&
   pnpm test && pnpm build`) before merging. This lands the Media Agent code + this migration
   file, but does not touch the production DB or enable the flag by itself.
2. **Apply the migration.** After explicit sign-off, run `supabase db push` from a shell with
   `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` set. Then run
   `supabase migration list` and confirm `20260703232736_create_media_agent_jobs` shows as
   applied both locally and remotely.
3. **Set the flag.** Run `vercel env add MEDIA_AGENT_ENABLED` and enter `true` for both
   **Production** and **Preview** environments (do not add it to Development unless local
   testing is intended — local dev can instead use `.env.local`). Redeploy (or wait for the
   next deploy) to pick up the new env var.
4. **Verify end-to-end in production.**
   - Confirm the Creative Studio panel now appears in the seller dashboard (it was previously
     absent/hidden because the route 404'd and any UI gate on it stayed hidden).
   - Trigger a real generate run from the dashboard for a listing with at least 3 photos and
     confirm a row is persisted in `media_agent_jobs` with `status = 'completed'` and a
     populated `strategy` payload.
   - Spot-check that a second run within the same hour is correctly rate-limited (3 requests /
     hour per user, per `apiLimiter("media-agent:generate", 3, "1 h")` in
     `src/app/api/media-agent/generate/route.ts`).

## Rollback / disable

To disable the Creative Studio instantly without a redeploy of code, change the env var only:

- Set `MEDIA_AGENT_ENABLED` to anything other than the literal string `"true"` (e.g. `"false"`),
  or remove it entirely, in the relevant Vercel environment(s).
- Redeploy (or trigger the env var to take effect per Vercel's env-var propagation) — once
  live, `POST /api/media-agent/generate` immediately fails closed to `404 { error: "not_found" }`
  again, per the fails-closed evidence above. No code change or migration rollback is required
  for this path; the database table can remain in place (it holds historical job rows and RLS
  already restricts access to `owner_id = auth.uid()`).
- Only run the migration rollback SQL above if the table itself needs to be removed (e.g.
  reverting the schema change entirely) — this is a separate, more destructive action from
  simply disabling the feature.

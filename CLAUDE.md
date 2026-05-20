# Lixtara — Claude Code conventions

Lixtara is an FSBO + licensed-broker real-estate platform for Florida. Three pricing tiers
(Essentials $199, Pro $495, Concierge $995), 24-month contract, zero traditional 6% commission.
The product was prototyped in Lovable as "AnaMaria Real Estate" / "Nexxos" / "neoxx-next-flow"
and is being ported to a clean Next.js stack inside this repo.

This file is the durable, in-repo guidance for any Claude session working in `/Code/lixtara`.
Project planning (phases, MVP scope, API inventory) lives in the user's auto-memory:
`~/.claude/projects/-Users-camiloisaza-Code-lixtara/memory/`. Read `MEMORY.md` there first.

## Stack

- **Next.js 16** App Router, Turbopack, React 19
- **TypeScript** strict, ESLint flat config (`eslint-config-next`)
- **Tailwind CSS v4** + **shadcn/ui** (style: `base-nova`, base color: `neutral`)
- **Supabase** Auth + Postgres + Storage + RLS — single project **`fizhoufepowilbhbtfkg`**
  (Nexxos-Direct-MVP, us-east-1, **production**). This is the ONLY database; the Lovable
  prototype used this same project from the start (there is no separate Lovable DB). Any
  other project ref found in code is outdated — ignore it. `@supabase/ssr` clients in
  `src/lib/supabase/`. Migrations are CLI-managed off a baseline — see "Database migrations".
- **i18n**: `[lang]` segment with `en` and `es`. Default `en`. Proxy in `src/proxy.ts`
  redirects unmatched paths to `/en`.
- **pnpm** (workspace: `allowBuilds` for `sharp` + `unrs-resolver`)
- Deploy: **Vercel** (Fluid Compute)

## Repo layout

```
src/
  app/
    [lang]/
      layout.tsx       # root layout, sets <html lang>
      page.tsx         # landing
    globals.css        # Tailwind + shadcn tokens
  components/
    ui/                # shadcn components only — do not edit by hand, regen via shadcn CLI
  lib/
    i18n.ts            # locale list + all EN/ES dictionaries inline (~1.9k lines; namespace split never happened)
    utils.ts           # cn() helper
    supabase/
      client.ts        # browser client
      server.ts        # RSC / route handler client
      middleware.ts    # session refresh helper (used by src/proxy.ts)
  proxy.ts             # Next 16 proxy (formerly middleware): locale redirect + session refresh
```

The Lovable reference codebase lives at `../lixtara-lovable-reference/` (read-only clone of
`cisaza76/neoxx-next-flow`). Port features by domain — do not bulk-copy.

## Non-negotiable conventions

### Naming
- The product is **Lixtara**. The Lovable prototype used "Nexxos" / "AnaMaria Real Estate".
  All new strings and identifiers use Lixtara. When porting from Lovable, rename `NEXXOS_*`
  → `LIXTARA_*` constants.

### Pricing
- Pricing tiers live in **one** module: `src/lib/pricing-tiers.ts`. Never hardcode
  `199`, `495`, `995` in components — import from there (and Stripe amounts derive from it).
- Virtual staging: `FREE_QUOTA = 3`, `PRICE_PER_ROOM = 500` cents, hard cap 30 rooms.
- Buyer rebate: `LIXTARA_BUYER_FEE_PCT = 0.5`, `REBATE_CAP = 50_000`.

### Auth & RLS
- Roles live in the `user_roles` table, never on `users`. Check via the `has_role()`
  SECURITY DEFINER function.
- All 28 tables have RLS active. Personal data follows `owner_id = auth.uid()`. Admin access
  goes through `has_role('admin')`.
- Email verification is **required**. Never enable auto-confirm.

### Supabase clients
- Browser: `import { createClient } from "@/lib/supabase/client"`
- Server (RSC / route handler / server action): `import { createClient } from "@/lib/supabase/server"`
- Proxy session refresh: handled automatically in `src/proxy.ts`

### Environment variables
- `NEXT_PUBLIC_SUPABASE_URL` — public, in `.env.local` and Vercel
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public, opaque key (replaces legacy `anon`).
  Format: `sb_publishable_...`. RLS still gates row access.
- `SUPABASE_SECRET_KEY` — server-only opaque key (replaces legacy `service_role`).
  Format: `sb_secret_...`. Never expose to the client.
- Legacy `anon` / `service_role` JWT keys are NOT used by this codebase. The Supabase
  project still has them active because Lovable depends on them — drop after cutover (F3+).
- Service keys for Stripe / DocuSign / Resend / Anthropic / Mapbox / Google Maps / Rentcast /
  Twilio are added phase by phase (see memory `phase_plan` and `api_inventory`).
- Upstash Redis — server-only, powers `src/lib/ratelimit.ts` (Loui + Stripe/DocuSign route
  caps). The Vercel Upstash Marketplace integration provisions `KV_REST_API_URL` /
  `KV_REST_API_TOKEN`; a manual Upstash DB uses `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`. `ratelimit.ts` reads either. When absent (local dev / CI) the
  limiters fail open; `enforceLimit` logs loudly in prod.
- Never commit `.env.local` (already in `.gitignore`). Mirror new vars to Vercel via
  `vercel env add`.

### Anti-patterns (drawn from the Lovable SOW)
- Do **not** propose Vite + React Router. The migration decision is Next.js App Router.
- Do **not** mount Supabase via Vercel Marketplace. The project is reused as-is — connect
  manually with the env vars above.
- Do **not** route through Lovable AI Gateway. AI calls go through Vercel AI Gateway or
  direct provider SDKs (Anthropic for text, separate provider for image gen).
- Do **not** build referrals (`/r/:code` short links + attribution) yet — still deferred
  post-go-live. (The earlier blanket "no AI / Investor Club / Loui in Fase 1" rule is obsolete:
  Loui chat, AI staging copy, the Investor Club volume teaser, and 3D tours all shipped ahead
  of the original plan — see Phase status.)
- Do **not** create, alter, or drop any table, function, or RLS policy on the production
  DB autonomously — schema changes go through a migration + explicit owner confirmation
  (see "Database migrations"). Do **not** run `supabase db push` without sign-off.

## Database migrations

The DB (`fizhoufepowilbhbtfkg`) is CLI-managed off a **baseline** captured 2026-05-20.

- **Baseline:** `supabase/migrations/20260520151434_remote_baseline.sql` — a schema-only dump of
  the production `public` schema (15 tables, 39 RLS policies, 3 functions, 4 triggers). Marked
  `applied` in the remote history via `migration repair`, so it is never re-run; it is the
  source of truth for the schema as of that date.
- **Archive:** the 15 pre-baseline files (date-only names, applied by hand before the pipeline
  existed) live in `supabase/migrations_archive/` as **historical reference only** — outside
  `supabase/migrations/` so the CLI ignores them. Do not move them back.
- **Credentials** (local only, in `.env.local`, gitignored): `SUPABASE_ACCESS_TOKEN`
  (Account → Access Tokens) and `SUPABASE_DB_PASSWORD` (Project Settings → Database).

### Adding a migration
1. `supabase migration new <name>` → `supabase/migrations/<14-digit-ts>_<name>.sql`.
2. Write the SQL. Filenames MUST be `<14-digit-timestamp>_name.sql`, version unique
   (`pnpm migrations:check` enforces this in CI).
3. Apply MANUALLY after owner sign-off: `supabase db push` (no auto-apply on merge, by design).
   Never alter the production schema outside this flow.

### Known drift to fix (out of band)
Code reads `agreements` and `schedule_requests`, but those tables **do not exist** (the real
table is `listing_agreements`; `schedule_requests` was never created). This breaks DocuSign
agreement persistence / the checkout gate and Loui scheduling. Fix via migration + code change,
with owner confirmation.

## Quality gates

Local before commit:
- `pnpm tsc --noEmit` must pass
- `pnpm lint` must pass
- `pnpm test` must pass (Vitest — `src/**/*.test.ts`, node env, `@/` alias)
- `pnpm migrations:check` must pass (validates migration filenames; read-only, no DB)
- `pnpm build` must pass

CI runs the same five on every push and pull request.

## Phase status

The clean linear F0→F4 plan in user memory (`phase_plan.md`) was overtaken by parallel
feature work — treat that file as historical intent, not current state. Some F5/F7 features
shipped ahead of the plan while F4 hardening is still outstanding.

**Shipped (on `main`, deployed):** bilingual landing + marketing pages; public `properties`
and `property/[id]`; full auth (sign-up/in, email verify, password reset); the 8-step seller
listing flow + seller dashboard; Stripe tier checkout + signature-verified, idempotent webhook
(dedup via `processed_webhook_events`, active since 2026-05-20); DocuSign
listing agreements (JWT auth) + webhook; Resend transactional emails; the admin broker-approval
queue + payments view; the buyer side (offers + saved properties); the Loui AI chat; AI staging
copy; KIRI 3D tours; and per-route rate limiting via Upstash (`src/lib/ratelimit.ts`).

**Not yet done — go-live debt:** test coverage is unit-only (Vitest covers pure logic —
pricing, buyer-rebate, status maps, i18n parity, webhook dedup; **webhooks, RLS, and route
handlers have no integration tests**); error/product analytics (Sentry/PostHog); the full
5-checkout Stripe set (only `tier` is wired); referrals; MLS sync; the FL DBPR / NAR
compliance review; and the `agreements` / `schedule_requests` code-vs-schema bug (code reads
tables that don't exist — see "Database migrations").

MVP scope and the original phase sequencing live in user memory (`mvp_scope_phase1.md`,
`phase_plan.md`).

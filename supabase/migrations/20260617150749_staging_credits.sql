-- AI virtual-staging overage credits.
-- Each listing gets STAGING_FREE_QUOTA (5) free staged photos; beyond that the
-- seller buys credits ($5/action). One row per user: a simple purchased/used
-- wallet. Writes go through the service role only (webhook grants, the staging
-- route consumes); users may read their own balance.

create table if not exists public.staging_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purchased integer not null default 0,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint staging_credits_nonneg check (purchased >= 0 and used >= 0)
);

alter table public.staging_credits enable row level security;

-- Sellers can read their own balance (to show "credits remaining").
drop policy if exists "staging_credits owner select" on public.staging_credits;
create policy "staging_credits owner select" on public.staging_credits
  for select using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies: only the service role (webhook grant +
-- staging route consume) mutates this table, and the service role bypasses RLS.

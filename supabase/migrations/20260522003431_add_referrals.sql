-- "Refer a friend, get $50 credit" program.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code text,
  referrer_id uuid references auth.users(id) on delete set null,
  referred_id uuid references auth.users(id) on delete set null,
  referred_email text,
  property_id uuid references public.properties(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'signed_up', 'closed')),
  reward_amount numeric(10,2) not null default 50,
  reward_paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referrals_status_idx on public.referrals (status);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;

drop policy if exists "referrals admin" on public.referrals;
create policy "referrals admin" on public.referrals for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());
drop policy if exists "referrals own" on public.referrals;
create policy "referrals own" on public.referrals for select
  using (auth.uid() = referrer_id);

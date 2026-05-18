-- Stripe payments tracking (F2.2 — tier listing fees). Each row is one
-- Checkout Session for a property's tier. We trust Stripe's webhook as the
-- canonical state source — never flip a row to 'succeeded' from the client.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  vendor text not null default 'stripe' check (vendor in ('stripe')),
  tier text not null check (tier in ('essentials', 'pro', 'concierge')),
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled')
  ),
  receipt_url text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists payments_property_id_idx
  on public.payments (property_id);
create index if not exists payments_owner_id_idx
  on public.payments (owner_id);
create index if not exists payments_status_idx
  on public.payments (status);
create index if not exists payments_session_id_idx
  on public.payments (stripe_session_id)
  where stripe_session_id is not null;

alter table public.payments enable row level security;

drop policy if exists "own payments select" on public.payments;
create policy "own payments select"
  on public.payments for select
  using (auth.uid() = owner_id);

drop policy if exists "own payments insert" on public.payments;
create policy "own payments insert"
  on public.payments for insert
  with check (auth.uid() = owner_id);

-- No client-side updates: status flips happen via service-role only from
-- the Stripe webhook handler. Refunds eventually go through admin tools.

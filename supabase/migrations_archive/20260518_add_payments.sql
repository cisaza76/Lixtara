-- Adapt the Lovable-origin payments table for F2.2 (Stripe tier checkout).
-- The base table already exists with user_id / amount / payment_type /
-- stripe_checkout_session_id columns. We add columns we need without
-- touching existing ones so the Lovable side keeps working during the
-- coexistence window.
alter table public.payments
  add column if not exists vendor text default 'stripe',
  add column if not exists tier text,
  add column if not exists receipt_url text,
  add column if not exists error_message text,
  add column if not exists completed_at timestamptz;

create index if not exists payments_user_id_idx
  on public.payments (user_id);
create index if not exists payments_status_idx
  on public.payments (status);
create index if not exists payments_property_id_idx
  on public.payments (property_id);
create unique index if not exists payments_checkout_session_uniq
  on public.payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.payments enable row level security;

drop policy if exists "own payments select" on public.payments;
create policy "own payments select"
  on public.payments for select
  using (auth.uid() = user_id);

drop policy if exists "own payments insert" on public.payments;
create policy "own payments insert"
  on public.payments for insert
  with check (auth.uid() = user_id);

-- No client-side updates: status flips happen via service-role only from
-- the Stripe webhook handler.

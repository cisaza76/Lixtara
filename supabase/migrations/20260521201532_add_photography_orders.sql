-- Reusable RLS helper for the admin panel: true when the caller has an admin or
-- broker role in user_roles. SECURITY DEFINER so it can be used inside policies.
create or replace function public.is_admin_or_broker()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $func$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'broker')
  );
$func$;

-- Professional photography orders ($495 add-on or included in Pro/Concierge).
create table if not exists public.photography_orders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending_schedule'
    check (status in ('pending_schedule', 'scheduled', 'completed', 'cancelled')),
  scheduled_date date,
  time_slot text check (time_slot in ('morning', 'afternoon', 'evening')),
  special_instructions text,
  photographer_name text,
  photographer_phone text,
  amount numeric(10,2),
  photos_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists photography_orders_status_idx
  on public.photography_orders (status);
create index if not exists photography_orders_property_idx
  on public.photography_orders (property_id);

alter table public.photography_orders enable row level security;

-- Admins/brokers manage everything; the seller can read their own orders.
drop policy if exists "photography admin manage" on public.photography_orders;
create policy "photography admin manage"
  on public.photography_orders for all
  using (public.is_admin_or_broker())
  with check (public.is_admin_or_broker());

drop policy if exists "photography own select" on public.photography_orders;
create policy "photography own select"
  on public.photography_orders for select
  using (auth.uid() = user_id);

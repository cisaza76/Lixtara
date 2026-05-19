-- Buyer side básico (F2.6): offers + saved_properties.
-- Lovable left an empty `offers` table; we drop and recreate with a schema
-- tuned to our flow (financing options, contingencies, seller counter).
-- No data is lost (count was 0 at migration time).

drop table if exists public.offers cascade;

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  -- Denormalised so RLS policies can gate seller reads without a join.
  seller_id uuid not null references auth.users(id) on delete cascade,

  offer_amount numeric not null check (offer_amount > 0),
  earnest_deposit numeric check (earnest_deposit is null or earnest_deposit >= 0),
  financing_type text not null check (
    financing_type in ('cash', 'conventional', 'fha', 'va', 'other')
  ),
  closing_date date,
  expiration_at timestamptz,
  contingencies text[] default '{}',
  message text,

  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'countered', 'withdrawn', 'expired')
  ),
  counter_amount numeric check (counter_amount is null or counter_amount > 0),
  counter_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists offers_property_id_idx on public.offers (property_id);
create index if not exists offers_buyer_id_idx on public.offers (buyer_id);
create index if not exists offers_seller_id_idx on public.offers (seller_id);
create index if not exists offers_status_idx on public.offers (status);

alter table public.offers enable row level security;

-- Buyer can see + insert their own offers.
drop policy if exists "own offers buyer select" on public.offers;
create policy "own offers buyer select"
  on public.offers for select
  using (auth.uid() = buyer_id);

drop policy if exists "own offers buyer insert" on public.offers;
create policy "own offers buyer insert"
  on public.offers for insert
  with check (auth.uid() = buyer_id);

drop policy if exists "own offers buyer update" on public.offers;
create policy "own offers buyer update"
  on public.offers for update
  using (auth.uid() = buyer_id);

-- Seller can see + update (accept/reject/counter) offers on their property.
drop policy if exists "offers seller select" on public.offers;
create policy "offers seller select"
  on public.offers for select
  using (auth.uid() = seller_id);

drop policy if exists "offers seller update" on public.offers;
create policy "offers seller update"
  on public.offers for update
  using (auth.uid() = seller_id);

-- Saved properties (heart toggle).
create table if not exists public.saved_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, property_id)
);

create index if not exists saved_properties_user_id_idx
  on public.saved_properties (user_id);
create index if not exists saved_properties_property_id_idx
  on public.saved_properties (property_id);

alter table public.saved_properties enable row level security;

drop policy if exists "own saves select" on public.saved_properties;
create policy "own saves select"
  on public.saved_properties for select
  using (auth.uid() = user_id);

drop policy if exists "own saves insert" on public.saved_properties;
create policy "own saves insert"
  on public.saved_properties for insert
  with check (auth.uid() = user_id);

drop policy if exists "own saves delete" on public.saved_properties;
create policy "own saves delete"
  on public.saved_properties for delete
  using (auth.uid() = user_id);

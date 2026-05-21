-- Roster of external partner agents who receive buyer leads (rebate-split model).
create table if not exists public.agent_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  license_number text,
  specialties text[],
  service_areas text[],
  languages text[],
  years_experience integer,
  deals_closed_last_year integer,
  average_sale_price numeric(12,2),
  zillow_rating numeric(2,1),
  review_count integer,
  photo_url text,
  bio text,
  accepts_rebate_split boolean not null default false,
  status text not null default 'pending'
    check (status in ('active', 'inactive', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_partners_status_idx
  on public.agent_partners (status);

alter table public.agent_partners enable row level security;

drop policy if exists "agents admin manage" on public.agent_partners;
create policy "agents admin manage" on public.agent_partners for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

-- Signed-in users can see active agents (buyer-facing matching).
drop policy if exists "agents read active" on public.agent_partners;
create policy "agents read active" on public.agent_partners for select
  to authenticated using (status = 'active');

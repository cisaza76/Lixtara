-- Buyer pipeline: leads from the AI chat / forms / property pages, with
-- qualification + behavioral scoring and an assigned partner agent.
create table if not exists public.buyer_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text,
  email text,
  phone text,
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  financing_type text,
  timeline text,
  first_time_buyer boolean,
  qualification_score integer,
  qualification_level text
    check (qualification_level in ('needs_preq', 'preq', 'strong_preq')),
  behavioral_score integer,
  lead_quality text check (lead_quality in ('cold', 'warm', 'hot')),
  ai_summary text,
  buyer_agreement_signed boolean not null default false,
  estimated_rebate numeric(12,2),
  assigned_agent_id uuid references public.agent_partners(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'assigned', 'closed', 'lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buyer_leads_status_idx on public.buyer_leads (status);
create index if not exists buyer_leads_quality_idx on public.buyer_leads (lead_quality);

alter table public.buyer_leads enable row level security;

drop policy if exists "buyer leads admin" on public.buyer_leads;
create policy "buyer leads admin" on public.buyer_leads for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());
drop policy if exists "buyer leads own" on public.buyer_leads;
create policy "buyer leads own" on public.buyer_leads for select
  using (auth.uid() = user_id);

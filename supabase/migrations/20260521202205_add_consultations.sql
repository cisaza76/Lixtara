-- Paid consultations: prepaid hour tokens + scheduled sessions (legal $450/hr,
-- broker strategy calls, etc.). Admin/broker manage; the buyer reads their own.

create table if not exists public.consultation_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_type text not null,
  hours_total numeric(5,2) not null default 1,
  hours_used numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.consultation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid references public.consultation_tokens(id) on delete set null,
  service_type text not null,
  topic text,
  scheduled_date timestamptz,
  duration_hours numeric(5,2) not null default 1,
  expert_name text,
  zoom_link text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultation_sessions_status_idx
  on public.consultation_sessions (status);
create index if not exists consultation_tokens_user_idx
  on public.consultation_tokens (user_id);

alter table public.consultation_tokens enable row level security;
alter table public.consultation_sessions enable row level security;

drop policy if exists "consult tokens admin" on public.consultation_tokens;
create policy "consult tokens admin" on public.consultation_tokens for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());
drop policy if exists "consult tokens own" on public.consultation_tokens;
create policy "consult tokens own" on public.consultation_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "consult sessions admin" on public.consultation_sessions;
create policy "consult sessions admin" on public.consultation_sessions for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());
drop policy if exists "consult sessions own" on public.consultation_sessions;
create policy "consult sessions own" on public.consultation_sessions for select
  using (auth.uid() = user_id);

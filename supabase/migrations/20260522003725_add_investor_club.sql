-- Investor Club applications (premium program for multi-property investors).
create table if not exists public.investor_club_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  applicant_name text,
  email text,
  phone text,
  company text,
  properties_closed_last_12mo integer,
  properties_planned_next_12mo integer,
  property_types text[],
  average_property_value numeric(12,2),
  proof_storage_path text,
  proposed_tier text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  dedicated_manager_id uuid references auth.users(id) on delete set null,
  rejection_reason text,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investor_club_status_idx
  on public.investor_club_members (status);

alter table public.investor_club_members enable row level security;

drop policy if exists "investor admin" on public.investor_club_members;
create policy "investor admin" on public.investor_club_members for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());
drop policy if exists "investor own" on public.investor_club_members;
create policy "investor own" on public.investor_club_members for select
  using (auth.uid() = user_id);

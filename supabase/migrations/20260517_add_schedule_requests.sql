-- Schedule requests originated by Loui (or other internal flows). The
-- brokerage triages from a dashboard / Resend notification; status flips
-- as the conversation moves.
create table if not exists public.schedule_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (
    request_type in (
      'consultation_attorney',
      'consultation_realtor',
      'strategy_call',
      'showing'
    )
  ),
  topic text not null,
  preferred_time text,
  notes text,
  source text not null default 'loui_chat',
  status text not null default 'pending' check (
    status in ('pending', 'scheduled', 'completed', 'cancelled')
  ),
  property_id uuid references public.properties(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedule_requests_user_id_idx
  on public.schedule_requests (user_id);
create index if not exists schedule_requests_status_idx
  on public.schedule_requests (status);

alter table public.schedule_requests enable row level security;

-- Owners can insert + read + update their own rows.
drop policy if exists "own schedule requests select"
  on public.schedule_requests;
create policy "own schedule requests select"
  on public.schedule_requests
  for select
  using (auth.uid() = user_id);

drop policy if exists "own schedule requests insert"
  on public.schedule_requests;
create policy "own schedule requests insert"
  on public.schedule_requests
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "own schedule requests update"
  on public.schedule_requests;
create policy "own schedule requests update"
  on public.schedule_requests
  for update
  using (auth.uid() = user_id);

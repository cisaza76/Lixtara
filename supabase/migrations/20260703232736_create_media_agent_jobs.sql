-- media_agent_jobs: one row per Media Intelligence Agent run for a listing.
-- The full analysis + strategy live in the versioned `strategy` jsonb payload.
-- No columns are added to property_photos; per-photo analysis is keyed by
-- photoId inside the payload. RLS: owner-only (owner_id = auth.uid()).
create table public.media_agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','analyzing','generating','completed','failed')),
  strategy     jsonb,
  providers    text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index media_agent_jobs_property_idx on public.media_agent_jobs (property_id);
create index media_agent_jobs_owner_idx    on public.media_agent_jobs (owner_id);

alter table public.media_agent_jobs enable row level security;

create policy "media_agent_jobs owner select" on public.media_agent_jobs
  for select using (owner_id = auth.uid());
create policy "media_agent_jobs owner insert" on public.media_agent_jobs
  for insert with check (owner_id = auth.uid());
create policy "media_agent_jobs owner update" on public.media_agent_jobs
  for update using (owner_id = auth.uid());

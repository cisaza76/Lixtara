-- 3D Gaussian Splatting tour jobs (KIRI Engine pipeline). Each row is one
-- video → .ply scene conversion attempt for a property. KIRI retains the
-- model for 3 days only, so once status flips to 'ready' the webhook must
-- download and persist to Supabase Storage immediately.
create table if not exists public.tour_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  vendor text not null default 'kiri' check (vendor in ('kiri')),
  kiri_task_id text,
  status text not null default 'uploading' check (
    status in ('uploading', 'queued', 'processing', 'ready', 'failed', 'expired')
  ),
  source_video_path text,
  source_video_size_bytes bigint,
  ply_storage_path text,
  ply_size_bytes bigint,
  error_message text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz
);

create index if not exists tour_jobs_property_id_idx
  on public.tour_jobs (property_id);
create index if not exists tour_jobs_owner_id_idx
  on public.tour_jobs (owner_id);
create index if not exists tour_jobs_kiri_task_id_idx
  on public.tour_jobs (kiri_task_id)
  where kiri_task_id is not null;

alter table public.tour_jobs enable row level security;

drop policy if exists "own tour jobs select" on public.tour_jobs;
create policy "own tour jobs select"
  on public.tour_jobs for select
  using (auth.uid() = owner_id);

drop policy if exists "own tour jobs insert" on public.tour_jobs;
create policy "own tour jobs insert"
  on public.tour_jobs for insert
  with check (auth.uid() = owner_id);

drop policy if exists "own tour jobs update" on public.tour_jobs;
create policy "own tour jobs update"
  on public.tour_jobs for update
  using (auth.uid() = owner_id);

-- Public can read ready tours of published properties (so the listing page
-- renders the .ply for buyers). Webhook writes via service-role bypass RLS.
drop policy if exists "ready tour jobs public select" on public.tour_jobs;
create policy "ready tour jobs public select"
  on public.tour_jobs for select
  using (
    status = 'ready'
    and exists (
      select 1 from public.properties p
      where p.id = tour_jobs.property_id
        and p.mls_status in ('active', 'pending_approval')
    )
  );

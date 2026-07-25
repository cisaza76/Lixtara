-- Creative Studio P2: assets (immutable, versioned) + creative_jobs + transitions.
-- Idempotent: safe to re-run (IF NOT EXISTS; policies drop-then-create). Owner applies.
-- RLS: sellers are READ-ONLY; all writes go through the service client (route + worker).

create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.properties(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('photo','video','render','staging','tour','thumbnail')),
  version       integer not null default 1,
  parent_asset  uuid references public.assets(id) on delete set null,
  source_type   text not null,                 -- 'property_photo' | 'generated' | ...
  source_id     text,                           -- wrapped source id (nullable for pure-generated)
  provenance    jsonb not null default '{}'::jsonb,  -- {sourceAssetIds,capability,engine,provider,prompt,templateId,templateVersion,bundleVersion,inputSchemaVersion,rendererVersion}
  storage_bucket text not null,
  storage_path   text not null,                  -- write-once; see unique index below
  checksum      text,                            -- sha256 of the bytes (integrity + audit)
  bytes         bigint not null default 0,
  mime          text not null default '',
  cost_usd      numeric not null default 0,
  cost_provider text,
  created_by    uuid not null references auth.users(id) on delete cascade,
  lifecycle     text not null default 'draft'
                check (lifecycle in ('draft','ready_for_review','approved','rejected','archived')),
  qa            jsonb,
  policy        jsonb,
  created_at    timestamptz not null default now()
);
-- lazy-wrap idempotency: exactly one Asset per wrapped source
create unique index if not exists assets_source_unique
  on public.assets (source_type, source_id) where source_id is not null;
-- a storage object backs exactly one Asset row (no two Assets share bytes)
create unique index if not exists assets_storage_unique
  on public.assets (storage_bucket, storage_path);
create index if not exists assets_listing_idx on public.assets (listing_id);
create index if not exists assets_parent_idx  on public.assets (parent_asset);

create table if not exists public.creative_jobs (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid not null references public.properties(id) on delete cascade,
  owner_id               uuid not null references auth.users(id) on delete cascade,
  capability             text not null default 'video',
  state                  text not null default 'queued'
                         check (state in ('queued','running','rendering','uploading','qa','completed','failed','cancelled')),
  asset_id               uuid references public.assets(id) on delete set null,  -- set at 'uploading'
  idempotency_key        text not null,     -- (listingId, templateVersion, ordered source-asset hash)
  attempts               integer not null default 0,
  max_attempts           integer not null default 3,
  claimed_at             timestamptz,       -- set atomically when a worker claims the job
  claimed_by             text,              -- worker/instance id
  heartbeat_at           timestamptz,       -- refreshed while active; drives abandoned-job recovery
  cancellation_requested boolean not null default false,
  timeout_ms             integer not null default 600000,   -- 10 min job ceiling
  error_code             text,              -- structured (e.g. 'render_failed','upload_failed','timeout','qa_failed')
  error_message          text,
  trace_id               text,              -- reserved: correlation id across job/transition/renderer/upload/QA; populated by the worker in a later task
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists creative_jobs_listing_idx on public.creative_jobs (listing_id);
create index if not exists creative_jobs_claimable_idx on public.creative_jobs (state, created_at);
-- one live job per identical request (idempotency). Partial: only non-terminal states.
create unique index if not exists creative_jobs_idempotency_active
  on public.creative_jobs (idempotency_key)
  where state in ('queued','running','rendering','uploading','qa');

create table if not exists public.creative_job_transitions (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.creative_jobs(id) on delete cascade,
  listing_id    uuid not null,
  user_id       uuid not null,             -- listing owner (for RLS)
  from_state    text not null,             -- old state
  to_state      text not null,             -- new state
  duration_ms   integer not null default 0,
  cost_usd      numeric not null default 0,
  cost_provider text,
  provider      text,
  capability    text,
  attempt       integer not null default 1,
  actor         text not null default 'system'  -- 'seller' | 'worker' | 'system'
                check (actor in ('seller','worker','system')),
  metadata      jsonb not null default '{}'::jsonb,
  error_code    text,
  error_message text,
  trace_id      text,              -- reserved: correlation id across job/transition/renderer/upload/QA; populated by the worker in a later task
  at            timestamptz not null default now()
);
create index if not exists creative_job_transitions_job_idx on public.creative_job_transitions (job_id);

alter table public.assets                   enable row level security;
alter table public.creative_jobs            enable row level security;
alter table public.creative_job_transitions enable row level security;

-- Sellers are READ-ONLY on all three tables (SELECT own only). No INSERT/UPDATE/DELETE policy
-- exists for any of them, so RLS denies writes to the seller by default; the service client
-- (route + worker) bypasses RLS for the controlled server-side writes. Transitions therefore
-- have NO update/delete path from the app at all -> append-only.
drop policy if exists "assets owner select" on public.assets;
create policy "assets owner select" on public.assets
  for select using (owner_id = auth.uid());

drop policy if exists "creative_jobs owner select" on public.creative_jobs;
create policy "creative_jobs owner select" on public.creative_jobs
  for select using (owner_id = auth.uid());

drop policy if exists "creative_job_transitions owner select" on public.creative_job_transitions;
create policy "creative_job_transitions owner select" on public.creative_job_transitions
  for select using (user_id = auth.uid());

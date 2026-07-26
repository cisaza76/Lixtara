-- F4.6 Stage C — `archived_at` on assets (design §5/§8.1).
--
-- `lifecycle='archived'` is the STATE; `archived_at` is the WHEN — set atomically with the
-- flip by the ArchiveWriter's single conditional UPDATE (never separately). Needed for future
-- GC-by-age and fast "archived only" filtering. Deliberately NOT added: archived_by /
-- archive_reason / restore fields (audit lives in activity_log; see the companion migration).
--
-- No CHECK change: 'archived' is already an allowed lifecycle value (creative_studio_video
-- migration). No RPC (owner decision 2026-07-23 — conditional UPDATE from the service client).
--
-- AUTHORED, NOT APPLIED. Apply with owner sign-off only (supabase db push).
alter table public.assets add column if not exists archived_at timestamptz;

-- Partial index: only archived rows carry a timestamp, so index only those (GC-by-age scans,
-- "archived only" listings). Active rows (archived_at is null) stay out of the index entirely.
create index if not exists assets_archived_at_idx
  on public.assets (archived_at)
  where archived_at is not null;

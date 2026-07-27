-- ROLLBACK for supabase/migrations/20260727180000_creative_studio_video_access.sql
-- (Gate 5 uploaded_video access control).
--
-- The forward migration creates exactly one table plus its three indexes and RLS enablement.
-- `drop table ... cascade` removes the table together with its indexes, policies (none), and
-- FK constraints — fully reversing the migration. No custom types/functions/triggers are
-- created by it, so nothing else needs dropping.
--
-- SAFE while no grants exist (the intended pre-Gate-5A state — the table ships EMPTY). Once
-- real allowlist rows exist, dropping loses that authorization state; prefer the runtime
-- kill-switches instead (unset CREATIVE_STUDIO_VIDEO_ENABLED for a global stop, or set
-- revoked_at on individual grants) which preserve the rows as evidence.
begin;

drop table if exists public.creative_studio_video_access cascade;

commit;

-- Post-rollback verification (expect 0 rows):
-- select tablename from pg_tables where schemaname='public'
--   and tablename = 'creative_studio_video_access';

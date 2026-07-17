-- ROLLBACK for migration supabase/migrations/20260715171914_creative_studio_video.sql
-- Captured 2026-07-17 BEFORE Production Runbook Step 1 (per the runbook's rule:
-- "keep the rollback SQL in this repo before you run push").
--
-- The forward migration creates exactly three tables plus their indexes, RLS
-- enablement, and three owner-select policies. `drop table ... cascade` removes the
-- table together with its indexes, policies, and any FK constraints — so these three
-- statements fully reverse the migration. No custom types/functions/triggers/extensions
-- are created by it, so nothing else needs dropping.
--
-- SAFE ONLY while the feature has never been live and these tables hold no rows.
-- Once beta data exists, DO NOT drop — roll back by unsetting the feature flag
-- (CREATIVE_STUDIO_VIDEO_ENABLED) instead, which hides the panel and 404s the route
-- while preserving data. Dropping tables with beta rows is data loss.

begin;

-- child first (creative_job_transitions references creative_jobs); cascade is belt-and-suspenders
drop table if exists public.creative_job_transitions cascade;
drop table if exists public.creative_jobs            cascade;
drop table if exists public.assets                   cascade;

commit;

-- Post-rollback verification (expect 0 rows):
-- select tablename from pg_tables where schemaname='public'
--   and tablename in ('assets','creative_jobs','creative_job_transitions');

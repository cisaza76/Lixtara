-- Fix the handle_new_user trigger to match the current public.users schema.
--
-- Background: Lovable's original migration (20260416135337) created
-- public.users with a separate `user_id UUID NOT NULL UNIQUE` column. A
-- later (un-migrated, Dashboard SQL) change dropped that column, making
-- `id` IS the auth.users.id directly. But the trigger never got updated —
-- it kept inserting into `user_id`, so new signups silently failed to
-- create a public.users row. Every downstream operation that joins users
-- (properties.owner_id FK, RLS checks, etc.) then failed.
--
-- This migration:
-- 1. Recreates the trigger using the current column (`id`, no user_id).
-- 2. Adds ON CONFLICT DO NOTHING for idempotency (re-running the trigger
--    or applying the migration twice won't duplicate rows).
-- 3. Backfills any auth.users that are missing from public.users
--    (covers users who signed up between Lovable's schema drift and
--    this fix — e.g. Camilo's account from 2026-05-17 smoke test).
--
-- Apply via Supabase Dashboard → SQL Editor → New query → Run.

-- 1. Recreate trigger function with correct column name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'phone', ''), '+10000000000')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2. Backfill missing rows
INSERT INTO public.users (id, email, first_name, last_name, phone)
SELECT
  au.id,
  au.email,
  au.raw_user_meta_data ->> 'first_name',
  au.raw_user_meta_data ->> 'last_name',
  COALESCE(NULLIF(au.raw_user_meta_data ->> 'phone', ''), '+10000000000')
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL;

-- Fix infinite recursion in public.users RLS policies.
-- Lovable's RLS chain had a policy that referenced public.users from within
-- a public.users policy (likely added via Dashboard SQL editor, not in
-- Lovable's migrations). PostgREST anon/publishable key reads of users OR
-- of any table that joins users (properties, property_photos) hit
-- `infinite recursion detected in policy for relation "users"`.
--
-- This migration:
-- 1. Drops every existing policy on public.users (defensive purge).
-- 2. Recreates 3 clean policies: own-record SELECT/INSERT/UPDATE — no
--    self-reference, no recursion.
-- 3. Ensures a public anon SELECT policy exists for properties where
--    mls_status='active' (re-applies what migration 20260417234806 had).
-- 4. Adds a matching public anon SELECT policy on property_photos for
--    photos whose parent property is active.
--
-- Apply via Supabase Dashboard → SQL Editor → New query → paste + run.

-- ─── 1. Purge all existing policies on public.users ───
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', pol.policyname);
  END LOOP;
END $$;

-- ─── 2. Clean users policies — own record only, no self-reference ───
CREATE POLICY "users_select_own"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_insert_own"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- NOTE: anon users have NO read access to users table — by design (PII).

-- ─── 3. Properties: public read of active listings ───
DROP POLICY IF EXISTS "properties_public_read_active" ON public.properties;
CREATE POLICY "properties_public_read_active"
  ON public.properties
  FOR SELECT
  TO anon, authenticated
  USING (mls_status = 'active');

-- ─── 4. Property photos: public read when parent property is active ───
DROP POLICY IF EXISTS "property_photos_public_read_active" ON public.property_photos;
CREATE POLICY "property_photos_public_read_active"
  ON public.property_photos
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_photos.property_id
        AND p.mls_status = 'active'
    )
  );

-- ─── 5. Sanity check ───
-- After running, verify with the publishable key (no auth header needed):
--   GET https://fizhoufepowilbhbtfkg.supabase.co/rest/v1/properties?select=id&mls_status=eq.active
--   Headers: apikey=<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>
-- Should return [{...}, ...] (the 6 demo rows). If still "infinite recursion",
-- there's another policy elsewhere (broker_tasks? listing_agreements?) that
-- references public.users without going through is_admin_or_broker() SECURITY
-- DEFINER. Hunt that down next.

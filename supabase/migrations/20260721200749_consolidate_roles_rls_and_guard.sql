-- Consolidate role-based authorization onto user_roles / is_admin_or_broker().
--
-- Problem (found 2026-07-21 during go-live audit):
--  1. ~9 RLS policies (7 public tables + 2 storage) trusted the LEGACY, self-writable
--     `public.users.role` column instead of the canonical `user_roles` table that the
--     app authorizes with (has_role() / is_admin_or_broker()). Admins live in user_roles,
--     NOT users.role, so broker/admin RLS silently denied every admin write.
--       -> Admin "Approve listing" no-op'd (UPDATE properties matched 0 rows) AND the
--          activity_log INSERT hard-failed (RLS), surfacing as a 500.
--  2. `public.users.role` is self-writable (users_update_own = auth.uid()=id, no column
--     guard), so ANY authenticated user could `update users set role='admin'` and escalate
--     to full broker/admin over payments, transactions, listings, contracts, proof-of-funds.
--
-- Fix: repoint every users.role-based policy to is_admin_or_broker() (STABLE SECURITY
-- DEFINER, reads user_roles), add the missing activity_log INSERT policy, and block
-- role self-escalation with a trigger that only permits the service role (the admin
-- user-management flow in admin/users/page.tsx uses the service client) to change role.
--
-- is_admin_or_broker() already exists:
--   select exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('admin','broker'))
--
-- NOTE: each broker policy below is ADDITIVE (OR'd) with the per-owner policies that stay
-- untouched (e.g. "Users can update own properties"). Only the broker/admin branch changes.

begin;

-- ── 1. public tables: SELECT-only broker views ──
drop policy if exists "Brokers can view all activity" on public.activity_log;
create policy "Brokers can view all activity" on public.activity_log
  for select to public using (public.is_admin_or_broker());

drop policy if exists "Brokers can view all payments" on public.payments;
create policy "Brokers can view all payments" on public.payments
  for select to public using (public.is_admin_or_broker());

-- ── 2. public tables: full broker management (ALL). Explicit WITH CHECK preserves the
--       original behavior (an ALL policy with no WITH CHECK reuses USING for writes). ──
drop policy if exists "Brokers can manage all tasks" on public.broker_tasks;
create policy "Brokers can manage all tasks" on public.broker_tasks
  for all to public using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

drop policy if exists "Brokers can manage all documents" on public.documents;
create policy "Brokers can manage all documents" on public.documents
  for all to public using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

drop policy if exists "Brokers can manage all agreements" on public.listing_agreements;
create policy "Brokers can manage all agreements" on public.listing_agreements
  for all to public using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

drop policy if exists "Brokers can view all properties" on public.properties;
create policy "Brokers can view all properties" on public.properties
  for all to public using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

drop policy if exists "Brokers can manage all transactions" on public.transactions;
create policy "Brokers can manage all transactions" on public.transactions
  for all to public using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

-- ── 3. activity_log MISSING INSERT policy — this is what 500'd the approve action. Both
--       activity_log writers (admin/page.tsx, listings/[id]/review) are admin/broker. ──
drop policy if exists "Admins and brokers can insert activity" on public.activity_log;
create policy "Admins and brokers can insert activity" on public.activity_log
  for insert to public with check (public.is_admin_or_broker());

-- ── 4. storage.objects: same repoint, preserving each policy's bucket filter and OR-branch ──
drop policy if exists "Brokers can manage contracts" on storage.objects;
create policy "Brokers can manage contracts" on storage.objects
  for all to public
  using (bucket_id = 'contracts' and public.is_admin_or_broker())
  with check (bucket_id = 'contracts' and public.is_admin_or_broker());

drop policy if exists "Users and brokers can view proof of funds" on storage.objects;
create policy "Users and brokers can view proof of funds" on storage.objects
  for select to public
  using (
    bucket_id = 'proof-of-funds'
    and (
      (auth.uid())::text = (storage.foldername(name))[1]
      or public.is_admin_or_broker()
    )
  );

-- ── 5. Block users.role self-escalation. The escalation vector is the two API-facing
--       roles PostgREST SET ROLE's into from a JWT: `authenticated` and `anon`. Block role
--       changes from exactly those; leave `service_role` (the admin user-management flow in
--       admin/users/page.tsx) and superusers (postgres/supabase_admin, for manual ops) free.
--       NOT security definer, so current_user reflects the SET ROLE'd request role. ──
create or replace function public.guard_users_role_change()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role and current_user in ('authenticated', 'anon') then
    raise exception 'Changing users.role is not permitted; use admin role management.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_users_role_change on public.users;
create trigger guard_users_role_change
  before update of role on public.users
  for each row execute function public.guard_users_role_change();

commit;

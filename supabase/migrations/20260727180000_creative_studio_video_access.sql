-- Gate 5 pre-rollout — uploaded_video access control (spec v2, frozen). Server-side allowlist
-- that gates who may see/use the Creative Studio video feature, with an optional per-listing
-- scope and a generation quota. Replaces the coarse "global flag only" exposure: with this
-- table EMPTY, NO user has access even while CREATIVE_STUDIO_VIDEO_ENABLED=true (fail-closed).
--
-- Authority model (see src/lib/creative-studio/video-access.ts): the ONLY reader/writer is the
-- service-role client. RLS is deny-all (enabled, no policies) so no anon/authenticated client
-- can read or write it — a seller can never self-authorize, and the row can never leak to a
-- browser. Grants and revocations are performed by a service-role admin script (out of this PR).
--
-- AUTHORED, NOT APPLIED. Apply with owner sign-off only (supabase db push). Rollback:
-- docs/superpowers/runbooks/rollback-20260727180000_creative_studio_video_access.sql
create table if not exists public.creative_studio_video_access (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- null = every listing the user owns; a uuid = that listing only.
  listing_id        uuid references public.properties(id) on delete cascade,
  enabled           boolean not null default true,
  -- Quota is a SAFETY RAIL, not a billing meter (spec v2 §0). The ceiling is enforced ONLY in
  -- the consume UPDATE (generations_used < max_generations), never as a CHECK, so an admin can
  -- lower max_generations below generations_used without fighting the constraint.
  max_generations   integer not null default 1 check (max_generations >= 0),
  generations_used  integer not null default 0 check (generations_used >= 0),
  valid_from        timestamptz,
  valid_until       timestamptz,
  approved_by       uuid not null references auth.users(id),
  reason            text not null,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One ACTIVE grant per scope. Two partial indexes (no sentinel UUID): the first covers
-- per-listing grants, the second the "all listings" (listing_id is null) grant.
create unique index if not exists creative_studio_video_access_user_listing_active
  on public.creative_studio_video_access (user_id, listing_id)
  where listing_id is not null and revoked_at is null;

create unique index if not exists creative_studio_video_access_user_all_active
  on public.creative_studio_video_access (user_id)
  where listing_id is null and revoked_at is null;

-- Read path: the access authority looks up active grants for a user.
create index if not exists creative_studio_video_access_user_lookup
  on public.creative_studio_video_access (user_id)
  where revoked_at is null;

-- Deny-all RLS: enabled with NO policies. anon/authenticated get nothing; the service-role
-- client (used exclusively by the server-side authority) bypasses RLS. No grants are issued to
-- anon/authenticated, so the table is invisible to every browser client.
alter table public.creative_studio_video_access enable row level security;

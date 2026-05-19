-- Role-based access control for admin pages (F2.4). Per CLAUDE.md spec:
-- roles live in user_roles, NEVER on the users table. has_role() is a
-- SECURITY DEFINER function so it can be called from RLS policies without
-- recursion or privilege concerns.

do $$ begin
  create type public.app_role as enum ('admin', 'broker', 'photographer');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);

alter table public.user_roles enable row level security;

-- Read access: a user can see their own roles. Admins can see all.
drop policy if exists "own roles select" on public.user_roles;
create policy "own roles select"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- Writes go through service-role only (no client-side role assignment).

create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $func$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = _role
  );
$func$;

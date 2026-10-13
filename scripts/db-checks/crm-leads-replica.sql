-- Réplica mínima de Supabase para verificar 20261012120000_crm_leads en un Postgres
-- desechable (la usa scripts/db-checks/run-crm-leads.sh). NUNCA contra producción.
--
-- Solo lo que la migración del CRM necesita: roles de la API, auth.users, auth.uid(),
-- app_role/user_roles/has_role() e is_admin_or_broker() (copias literales de prod).
\set ON_ERROR_STOP on
\set QUIET on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
-- Igual que Supabase: toda tabla nueva de public nace con ALL para los tres roles. Sin esto
-- la migración parecería segura por accidente (nadie tendría permisos que revocar).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create type public.app_role as enum ('admin', 'broker', 'photographer');
create table public.user_roles (id uuid primary key default gen_random_uuid(),
  user_id uuid not null, role public.app_role not null, created_at timestamptz default now());
alter table public.user_roles enable row level security;
create policy "own roles select" on public.user_roles for select to public using (auth.uid() = user_id);
grant all on public.user_roles to anon, authenticated, service_role;

create function public.has_role(_role public.app_role) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role);
$$;
create function public.is_admin_or_broker() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles
                  where user_id = auth.uid() and role in ('admin', 'broker'));
$$;

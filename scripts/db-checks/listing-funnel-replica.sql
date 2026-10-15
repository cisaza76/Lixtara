-- Réplica mínima para verificar 20261014150000_listing_funnel_view en un Postgres desechable
-- (la usa run-listing-funnel.sh). NUNCA contra producción. Reutiliza crm-leads-replica.sql
-- (roles de la API, auth.users, auth.uid(), user_roles, is_admin_or_broker()) y agrega
-- properties (solo las columnas que usa la vista) y funnel_events tal como está en prod
-- (copia literal de 20261003004631_seller_funnel_leads_events_otp.sql, sección 2).
\set ON_ERROR_STOP on
\set QUIET on

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  pricing_tier text,
  is_test boolean not null default false,
  created_at timestamptz default now()
);
alter table public.properties enable row level security;
create policy "owner reads" on public.properties for select using (owner_id = auth.uid());
create policy "staff reads" on public.properties for select using (public.is_admin_or_broker());

create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid,
  property_id uuid references public.properties(id) on delete set null,
  event text not null check (event ~ '^[a-z][a-z0-9_]{2,63}$'),
  step smallint check (step between 0 and 8),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint funnel_events_metadata_shape check (
    jsonb_typeof(metadata) = 'object'
    and pg_column_size(metadata) <= 1024
    and metadata::text !~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
  )
);
alter table public.funnel_events enable row level security;
create policy "funnel events admin read" on public.funnel_events for select
  using (public.is_admin_or_broker());
revoke update, delete on public.funnel_events from anon, authenticated;

-- Una fila previa a la migración (sin is_test): debe quedar en false.
insert into public.properties (id, owner_id, pricing_tier)
  values ('00000000-0000-4000-8000-0000000000aa', gen_random_uuid(), 'pro');
insert into public.funnel_events (property_id, event, step, metadata)
  values ('00000000-0000-4000-8000-0000000000aa', 'listing_step_complete', 1, '{"lang":"en"}');

-- Verificación de 20260927120000_guard_properties_mls_status contra un Postgres real.
-- La corre scripts/db-checks/run-guard-properties-mls-status.sh en un contenedor
-- desechable: NUNCA contra producción.
--
-- Réplica mínima de Supabase: roles de la API, auth.uid() (copia literal de prod),
-- user_roles, is_admin_or_broker() (copia literal de prod) y las MISMAS políticas RLS de
-- public.properties que hay en producción (leídas el 2026-09-27).
\set ON_ERROR_STOP on
\set QUIET on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create table public.user_roles (user_id uuid, role text);
create function public.is_admin_or_broker() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles
                  where user_id = auth.uid() and role in ('admin', 'broker'));
$$;

create table public.properties (
  id uuid primary key,
  owner_id uuid not null,
  list_price numeric,
  pricing_tier text,
  mls_number text unique,
  mls_status text default 'draft' check (mls_status = any (array['draft','pending_approval',
    'active','under_contract','closed','expired','withdrawn'])),
  mls_published_at timestamptz,
  mls_expires_at timestamptz
);
alter table public.properties enable row level security;
create policy "Brokers can view all properties" on public.properties for all to public
  using (is_admin_or_broker()) with check (is_admin_or_broker());
create policy "Public can view active listings" on public.properties for select to public
  using (mls_status = 'active');
create policy "Users can insert own properties" on public.properties for insert to public
  with check (auth.uid() = owner_id);
create policy "Users can update own properties" on public.properties for update to public
  using (auth.uid() = owner_id);
create policy "Users can view own properties" on public.properties for select to public
  using (auth.uid() = owner_id);
grant select, insert, update, delete on public.properties to anon, authenticated, service_role;

-- Actores
\set seller  '''11111111-1111-4111-8111-111111111111'''
\set broker  '''22222222-2222-4222-8222-222222222222'''
insert into public.user_roles values (:broker, 'broker');
insert into public.properties (id, owner_id, mls_status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', :seller, 'draft'),
  ('aaaaaaaa-0000-4000-8000-000000000002', :seller, 'pending_approval'),
  ('aaaaaaaa-0000-4000-8000-000000000006', :seller, 'active');

-- Ejecuta `stmt` como `rol` con el `sub` dado. Devuelve 'OK:<filas afectadas>' o
-- 'ERR:<sqlstate>'. Las filas importan: bajo RLS un UPDATE sin permiso "funciona" con 0.
create function pg_temp.intento(rol text, sub text, stmt text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  execute format('set local role %I', rol);
  begin
    execute stmt;
    get diagnostics n = row_count;
    reset role;
    return 'OK:' || n;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate;
  end;
end;
$$;

create table pg_temp.casos (orden int, nombre text, rol text, sub text, stmt text, antes text, despues text);
insert into pg_temp.casos (orden, nombre, rol, sub, stmt) values
 (1, 'vendedor se auto-aprueba (draft → active)', 'authenticated', :seller,
     $$update public.properties set mls_status = 'active' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (2, 'vendedor se auto-aprueba (pending_approval → active)', 'authenticated', :seller,
     $$update public.properties set mls_status = 'active' where id = 'aaaaaaaa-0000-4000-8000-000000000002'$$),
 (3, 'vendedor salta el pago (draft → pending_approval)', 'authenticated', :seller,
     $$update public.properties set mls_status = 'pending_approval' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (4, 'vendedor inserta un listing ya activo', 'authenticated', :seller,
     $$insert into public.properties (id, owner_id, mls_status) values ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'active')$$),
 (5, 'vendedor fija mls_published_at', 'authenticated', :seller,
     $$update public.properties set mls_published_at = now() where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (6, 'vendedor crea su borrador (legítimo)', 'authenticated', :seller,
     $$insert into public.properties (id, owner_id, mls_status) values ('aaaaaaaa-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'draft')$$),
 (7, 'vendedor crea borrador sin mls_status (default draft)', 'authenticated', :seller,
     $$insert into public.properties (id, owner_id) values ('aaaaaaaa-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111')$$),
 (8, 'vendedor edita precio y tier de su borrador (legítimo)', 'authenticated', :seller,
     $$update public.properties set list_price = 500000, pricing_tier = 'pro' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (9, 'vendedor reescribe el MISMO estado (no-op)', 'authenticated', :seller,
     $$update public.properties set mls_status = 'draft' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (10, 'webhook Stripe: draft → pending_approval (service_role)', 'service_role', null,
     $$update public.properties set mls_status = 'pending_approval' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (11, 'broker aprueba (pending_approval → active)', 'authenticated', :broker,
     $$update public.properties set mls_status = 'active' where id = 'aaaaaaaa-0000-4000-8000-000000000002'$$),
 (12, 'broker pide cambios (active → draft)', 'authenticated', :broker,
     $$update public.properties set mls_status = 'draft' where id = 'aaaaaaaa-0000-4000-8000-000000000006'$$),
 (13, 'anónimo intenta activar (RLS: 0 filas)', 'anon', null,
     $$update public.properties set mls_status = 'active' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$),
 (14, 'vendedor retira su listing activo (active → withdrawn)', 'authenticated', :seller,
     $$update public.properties set mls_status = 'withdrawn' where id = 'aaaaaaaa-0000-4000-8000-000000000006'$$),
 (15, 'vendedor edita el precio de su listing ACTIVO (legítimo)', 'authenticated', :seller,
     $$update public.properties set list_price = 480000 where id = 'aaaaaaaa-0000-4000-8000-000000000006'$$);

-- Cada caso corre en un subbloque que se deshace al final: todos parten del mismo estado.
-- (Las variables de plpgsql no son transaccionales: `r` sobrevive al rollback.)
create function pg_temp.correr(col text) returns void language plpgsql as $$
declare c record; r text;
begin
  for c in select * from pg_temp.casos order by orden loop
    begin
      r := pg_temp.intento(c.rol, c.sub, c.stmt);
      raise exception 'deshacer';
    exception when raise_exception then
      null;
    end;
    execute format('update pg_temp.casos set %I = $1 where orden = $2', col) using r, c.orden;
  end loop;
end;
$$;

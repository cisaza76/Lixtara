-- Verificación de 20260927120000_guard_properties_mls_status contra un Postgres real.
-- La corre scripts/db-checks/run-guard-properties-mls-status.sh en un contenedor
-- desechable: NUNCA contra producción.
--
-- Réplica mínima de Supabase: roles de la API, auth.uid(), app_role/user_roles/has_role(),
-- is_admin_or_broker() (copias literales de prod) y las MISMAS políticas RLS y grants de
-- properties, user_roles, payments y agreements que hay en producción (leídas el
-- 2026-09-27). Los casos se ejecutan con `SET LOCAL ROLE`, igual que PostgREST.
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
-- Igual que Supabase: toda tabla nueva de public nace con ALL para los tres roles. Sin esto
-- la migración parecería segura por accidente (nadie tendría permisos que revocar).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- Roles: fuente de is_admin_or_broker(). Política y grants como en prod.
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

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  list_price numeric,
  description text,
  pricing_tier text check (pricing_tier is null or pricing_tier in ('essentials','pro','concierge')),
  mls_number text unique,
  mls_status text default 'draft' check (mls_status = any (array['draft','pending_approval',
    'active','under_contract','closed','expired','withdrawn'])),
  mls_published_at timestamptz,
  mls_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create function public.update_updated_at_column() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger update_properties_updated_at before update on public.properties
  for each row execute function public.update_updated_at_column();
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
create policy "properties_public_read_active" on public.properties for select to anon, authenticated
  using (mls_status = 'active');
grant all on public.properties to anon, authenticated, service_role;

create table public.payments (id uuid primary key default gen_random_uuid(), user_id uuid,
  property_id uuid, amount numeric, tier text, status text check (status in ('pending','succeeded','failed','refunded')),
  stripe_checkout_session_id text, stripe_payment_intent_id text, stripe_charge_id text,
  receipt_url text, completed_at timestamptz);
alter table public.payments enable row level security;
create policy "own payments insert" on public.payments for insert to public with check (auth.uid() = user_id);
create policy "own payments select" on public.payments for select to public using (auth.uid() = user_id);
grant all on public.payments to anon, authenticated, service_role;

create table public.agreements (id uuid primary key default gen_random_uuid(), property_id uuid,
  owner_id uuid, status text default 'pending' check (status in ('pending','sent','delivered',
  'signed','completed','declined','voided','expired')), signed_at timestamptz);
alter table public.agreements enable row level security;
create policy "own agreements insert" on public.agreements for insert to public with check (auth.uid() = owner_id);
create policy "own agreements select" on public.agreements for select to public using (auth.uid() = owner_id);
grant all on public.agreements to anon, authenticated, service_role;

-- Actores: vendedor (con un rol 'photographer' propio, para probar el auto-ascenso),
-- otro vendedor, broker y admin.
\set seller  '''11111111-1111-4111-8111-111111111111'''
\set otro    '''33333333-3333-4333-8333-333333333333'''
\set broker  '''22222222-2222-4222-8222-222222222222'''
\set admin   '''44444444-4444-4444-8444-444444444444'''
insert into public.user_roles (user_id, role) values
  (:broker, 'broker'), (:admin, 'admin'), (:seller, 'photographer');
insert into public.properties (id, owner_id, mls_status, pricing_tier) values
  ('aaaaaaaa-0000-4000-8000-000000000001', :seller, 'draft', 'essentials'),
  ('aaaaaaaa-0000-4000-8000-000000000002', :seller, 'pending_approval', 'essentials'),
  ('aaaaaaaa-0000-4000-8000-000000000006', :seller, 'active', 'essentials'),
  ('aaaaaaaa-0000-4000-8000-000000000007', :otro, 'draft', 'pro');

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

create table pg_temp.casos (orden int, grupo text, nombre text, rol text, sub text, stmt text,
  esperado text, antes text, despues text);

\set P1 '''aaaaaaaa-0000-4000-8000-000000000001'''
\set P2 '''aaaaaaaa-0000-4000-8000-000000000002'''
\set P6 '''aaaaaaaa-0000-4000-8000-000000000006'''
\set P7 '''aaaaaaaa-0000-4000-8000-000000000007'''

insert into pg_temp.casos (orden, grupo, nombre, rol, sub, stmt, esperado) values
 -- Estado y publicación
 (1, 'estado', 'vendedor se auto-aprueba (draft → active)', 'authenticated', :seller,
     format($$update public.properties set mls_status = 'active' where id = %L$$, :P1), 'ERR'),
 (2, 'estado', 'vendedor se auto-aprueba (pending_approval → active)', 'authenticated', :seller,
     format($$update public.properties set mls_status = 'active' where id = %L$$, :P2), 'ERR'),
 (3, 'estado', 'vendedor salta el pago (draft → pending_approval)', 'authenticated', :seller,
     format($$update public.properties set mls_status = 'pending_approval' where id = %L$$, :P1), 'ERR'),
 (4, 'estado', 'vendedor inserta un listing ya activo', 'authenticated', :seller,
     format($$insert into public.properties (owner_id, mls_status) values (%L, 'active')$$, :seller), 'ERR'),
 (5, 'estado', 'vendedor fija mls_published_at', 'authenticated', :seller,
     format($$update public.properties set mls_published_at = now() where id = %L$$, :P1), 'ERR'),
 (6, 'estado', 'vendedor retira su listing activo (active → withdrawn)', 'authenticated', :seller,
     format($$update public.properties set mls_status = 'withdrawn' where id = %L$$, :P6), 'ERR'),
 -- Columnas protegidas (lista de permitidas)
 (10, 'columnas', 'vendedor cambia pricing_tier DESPUÉS de pagar (pending_approval)', 'authenticated', :seller,
     format($$update public.properties set pricing_tier = 'concierge' where id = %L$$, :P2), 'ERR'),
 (11, 'columnas', 'vendedor cambia pricing_tier de su listing ACTIVO', 'authenticated', :seller,
     format($$update public.properties set pricing_tier = 'concierge' where id = %L$$, :P6), 'ERR'),
 (12, 'columnas', 'vendedor se asigna un mls_number', 'authenticated', :seller,
     format($$update public.properties set mls_number = 'A11234567' where id = %L$$, :P6), 'ERR'),
 (13, 'columnas', 'vendedor cambia owner_id de su listing', 'authenticated', :seller,
     format($$update public.properties set owner_id = %L where id = %L$$, :otro, :P1), 'ERR'),
 (14, 'columnas', 'vendedor reescribe created_at', 'authenticated', :seller,
     format($$update public.properties set created_at = '2020-01-01' where id = %L$$, :P1), 'ERR'),
 (15, 'columnas', 'vendedor se marca is_test (se oculta)', 'authenticated', :seller,
     format($$update public.properties set is_test = true where id = %L$$, :P6), 'ERR'),
 -- Flujos legítimos del vendedor
 (20, 'legítimo', 'vendedor crea su borrador', 'authenticated', :seller,
     format($$insert into public.properties (owner_id, mls_status, pricing_tier) values (%L, 'draft', 'pro')$$, :seller), 'OK:1'),
 (21, 'legítimo', 'vendedor crea borrador sin mls_status (default)', 'authenticated', :seller,
     format($$insert into public.properties (owner_id) values (%L)$$, :seller), 'OK:1'),
 (22, 'legítimo', 'vendedor elige pricing_tier en su BORRADOR', 'authenticated', :seller,
     format($$update public.properties set pricing_tier = 'concierge' where id = %L$$, :P1), 'OK:1'),
 (23, 'legítimo', 'vendedor edita precio y descripción de su borrador', 'authenticated', :seller,
     format($$update public.properties set list_price = 500000, description = 'x' where id = %L$$, :P1), 'OK:1'),
 (24, 'legítimo', 'vendedor edita el precio de su listing ACTIVO', 'authenticated', :seller,
     format($$update public.properties set list_price = 480000 where id = %L$$, :P6), 'OK:1'),
 (25, 'legítimo', 'vendedor reescribe el MISMO estado y tier (no-op)', 'authenticated', :seller,
     format($$update public.properties set mls_status = 'active', pricing_tier = 'essentials' where id = %L$$, :P6), 'OK:1'),
 (26, 'legítimo', 'vendedor no toca listings ajenos (RLS: 0 filas)', 'authenticated', :seller,
     format($$update public.properties set list_price = 1 where id = %L$$, :P7), 'OK:0'),
 -- Service role, broker, admin
 (30, 'staff', 'webhook Stripe: draft → pending_approval + tier (service_role)', 'service_role', null,
     format($$update public.properties set mls_status = 'pending_approval', pricing_tier = 'pro' where id = %L$$, :P1), 'OK:1'),
 (31, 'staff', 'broker aprueba (pending_approval → active)', 'authenticated', :broker,
     format($$update public.properties set mls_status = 'active' where id = %L$$, :P2), 'OK:1'),
 (32, 'staff', 'broker pide cambios (active → draft)', 'authenticated', :broker,
     format($$update public.properties set mls_status = 'draft' where id = %L$$, :P6), 'OK:1'),
 (33, 'staff', 'broker anota el mls_number', 'authenticated', :broker,
     format($$update public.properties set mls_number = 'A11234567' where id = %L$$, :P6), 'OK:1'),
 (34, 'staff', 'broker intenta marcar is_test (solo admin)', 'authenticated', :broker,
     format($$update public.properties set is_test = true where id = %L$$, :P6), 'ERR'),
 (35, 'staff', 'admin marca is_test', 'authenticated', :admin,
     format($$update public.properties set is_test = true where id = %L$$, :P6), 'OK:1'),
 (36, 'staff', 'service_role marca is_test', 'service_role', null,
     format($$update public.properties set is_test = true where id = %L$$, :P6), 'OK:1'),
 (37, 'staff', 'anónimo intenta activar (RLS: 0 filas)', 'anon', null,
     format($$update public.properties set mls_status = 'active' where id = %L$$, :P1), 'OK:0'),
 -- Auto-ascenso de rol (fuente de is_admin_or_broker)
 (40, 'rol', 'vendedor se inserta el rol admin', 'authenticated', :seller,
     format($$insert into public.user_roles (user_id, role) values (%L, 'admin')$$, :seller), 'ERR'),
 (41, 'rol', 'vendedor sube su rol photographer → admin', 'authenticated', :seller,
     format($$update public.user_roles set role = 'admin' where user_id = %L$$, :seller), 'OK:0'),
 (42, 'rol', 'vendedor le quita el rol al broker', 'authenticated', :seller,
     format($$delete from public.user_roles where user_id = %L$$, :broker), 'OK:0'),
 -- Pagos y acuerdos falsificados
 (50, 'pagos', 'vendedor inserta un pago "succeeded"', 'authenticated', :seller,
     format($$insert into public.payments (user_id, property_id, status, tier, amount, completed_at) values (%L, %L, 'succeeded', 'concierge', 995, now())$$, :seller, :P1), 'ERR'),
 (51, 'pagos', 'vendedor inserta un pago pendiente con payment_intent', 'authenticated', :seller,
     format($$insert into public.payments (user_id, property_id, status, stripe_payment_intent_id) values (%L, %L, 'pending', 'pi_fake')$$, :seller, :P1), 'ERR'),
 (52, 'pagos', 'vendedor inserta un pago pendiente sobre listing AJENO', 'authenticated', :seller,
     format($$insert into public.payments (user_id, property_id, status) values (%L, %L, 'pending')$$, :seller, :P7), 'ERR'),
 (53, 'pagos', 'checkout: pago pendiente propio (legítimo)', 'authenticated', :seller,
     format($$insert into public.payments (user_id, property_id, status, tier, amount, stripe_checkout_session_id) values (%L, %L, 'pending', 'pro', 495, 'cs_test_x')$$, :seller, :P1), 'OK:1'),
 (54, 'pagos', 'vendedor inserta un acuerdo "signed"', 'authenticated', :seller,
     format($$insert into public.agreements (owner_id, property_id, status, signed_at) values (%L, %L, 'signed', now())$$, :seller, :P1), 'ERR'),
 (55, 'pagos', 'agreement/create: acuerdo "sent" propio (legítimo)', 'authenticated', :seller,
     format($$insert into public.agreements (owner_id, property_id, status) values (%L, %L, 'sent')$$, :seller, :P1), 'OK:1'),
 (56, 'pagos', 'webhook Stripe marca el pago succeeded (service_role)', 'service_role', null,
     format($$insert into public.payments (user_id, property_id, status, completed_at) values (%L, %L, 'succeeded', now())$$, :seller, :P1), 'OK:1'),
 -- Historial (solo existe DESPUÉS)
 (60, 'historial', 'vendedor escribe en el historial', 'authenticated', :seller,
     format($$insert into public.property_status_history (property_id, new_status, changed_by) values (%L, 'active', 'x')$$, :P1), 'ERR'),
 (61, 'historial', 'broker borra el historial', 'authenticated', :broker,
     $$delete from public.property_status_history$$, 'ERR'),
 (62, 'historial', 'broker edita el historial', 'authenticated', :broker,
     $$update public.property_status_history set changed_by = 'x'$$, 'ERR'),
 (63, 'historial', 'service_role borra el historial (permitido)', 'service_role', null,
     $$delete from public.property_status_history where false$$, 'OK:0');

-- Cada caso corre en un subbloque que se deshace: todos parten del mismo estado.
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

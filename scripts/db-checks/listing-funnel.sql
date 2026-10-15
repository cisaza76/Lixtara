-- Casos de 20261014150000_listing_funnel_view. Se corren DESPUÉS de aplicar la migración, en
-- un Postgres desechable (run-listing-funnel.sh). NUNCA contra producción.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

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

\o /dev/null
create table pg_temp.res (orden serial, caso text, esperado text, obtenido text);
create function pg_temp.chk(caso text, esperado text, obtenido text) returns void
  language sql as $$ insert into pg_temp.res (caso, esperado, obtenido) values ($1, $2, $3) $$;

\set ADMIN '''11111111-1111-4111-8111-111111111111'''
\set SELLER '''44444444-4444-4444-8444-444444444444'''
insert into auth.users (id) values (:ADMIN), (:SELLER) on conflict do nothing;
insert into public.user_roles (user_id, role) values (:ADMIN, 'admin');

-- L1 real y pagado; L2 real a medias, retomado; L3 propiedad is_test; L4 solo eventos is_test
insert into public.properties (id, owner_id, pricing_tier, is_test) values
  ('00000000-0000-4000-8000-000000000001', :SELLER, 'pro', false),
  ('00000000-0000-4000-8000-000000000002', :SELLER, 'essentials', false),
  ('00000000-0000-4000-8000-000000000003', :SELLER, 'pro', true),
  ('00000000-0000-4000-8000-000000000004', :SELLER, 'pro', false);

insert into public.funnel_events (property_id, event, step, metadata, is_test, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'listing_step_complete', 1,
     '{"lang":"es","utm_source":"google","utm_medium":"cpc","utm_campaign":"fsbo"}', false, '2026-10-14 10:00Z'),
  ('00000000-0000-4000-8000-000000000001', 'listing_step_complete', 2, '{"lang":"es","plan_tier":"pro"}', false, '2026-10-14 10:05Z'),
  -- volvió atrás y terminó el paso 1 otra vez: cuenta la primera vez, y sus UTM
  ('00000000-0000-4000-8000-000000000001', 'listing_step_complete', 1, '{"lang":"en","utm_source":"meta"}', false, '2026-10-14 10:07Z'),
  ('00000000-0000-4000-8000-000000000001', 'listing_step_complete', 7, '{}', false, '2026-10-14 11:00Z'),
  ('00000000-0000-4000-8000-000000000001', 'agreement_signed', 7, '{}', false, '2026-10-14 11:00Z'),
  ('00000000-0000-4000-8000-000000000001', 'checkout_started', 8, '{"lang":"es"}', false, '2026-10-14 11:02Z'),
  ('00000000-0000-4000-8000-000000000001', 'listing_paid', 8, '{"amount":495,"plan_tier":"pro"}', false, '2026-10-14 11:03Z'),
  ('00000000-0000-4000-8000-000000000002', 'listing_step_complete', 1, '{"lang":"en"}', false, '2026-10-14 12:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'listing_step_complete', 3, '{"lang":"en"}', false, '2026-10-14 12:10Z'),
  ('00000000-0000-4000-8000-000000000002', 'listing_resumed', 4, '{"lang":"en","source":"email_link"}', false, '2026-10-15 09:00Z'),
  -- evento de prueba sobre un listing real: no cuenta
  ('00000000-0000-4000-8000-000000000002', 'listing_paid', 8, '{"amount":199}', true, '2026-10-15 10:00Z'),
  ('00000000-0000-4000-8000-000000000003', 'listing_step_complete', 1, '{"lang":"en"}', false, now()),
  ('00000000-0000-4000-8000-000000000004', 'listing_step_complete', 1, '{"lang":"en"}', true, now());

select pg_temp.chk('vista: L1, L2 y la fila previa; sin propiedad is_test ni solo-pruebas', '3',
  (select count(*)::text from public.listing_funnel_v));
select pg_temp.chk('fila previa a la migración quedó is_test=false', 'false',
  (select string_agg(is_test::text, ',') from public.funnel_events where property_id = '00000000-0000-4000-8000-0000000000aa'));
select pg_temp.chk('L1: primera vez de cada paso, firma, checkout y pago', '10:00|10:05|11:00|11:00|11:02|11:03|495|8',
  (select concat_ws('|', to_char(step1_completed_at at time zone 'UTC', 'HH24:MI'), to_char(step2_completed_at at time zone 'UTC', 'HH24:MI'),
     to_char(step7_completed_at at time zone 'UTC', 'HH24:MI'), to_char(agreement_signed_at at time zone 'UTC', 'HH24:MI'),
     to_char(checkout_started_at at time zone 'UTC', 'HH24:MI'), to_char(paid_at at time zone 'UTC', 'HH24:MI'), amount_paid, last_step_reached)
     from public.listing_funnel_v where listing_id = '00000000-0000-4000-8000-000000000001'));
select pg_temp.chk('L1: idioma y UTM del primer contacto', 'es|google|cpc|fsbo|pro|f',
  (select concat_ws('|', lang, utm_source, utm_medium, utm_campaign, plan_tier, resumed_via_link)
     from public.listing_funnel_v where listing_id = '00000000-0000-4000-8000-000000000001'));
select pg_temp.chk('L2: llegó al paso 4, retomado, el pago de prueba no cuenta', '4|t|-|-|-',
  (select concat_ws('|', last_step_reached, resumed_via_link, coalesce(paid_at::text, '-'),
     coalesce(amount_paid::text, '-'), coalesce(utm_source, '-'))
     from public.listing_funnel_v where listing_id = '00000000-0000-4000-8000-000000000002'));
select pg_temp.chk('sin datos personales: columnas exactas de la vista',
  'listing_id,created_at,lang,plan_tier,step1_completed_at,step2_completed_at,step3_completed_at,step4_completed_at,step5_completed_at,step6_completed_at,step7_completed_at,agreement_signed_at,checkout_started_at,paid_at,amount_paid,last_step_reached,resumed_via_link,utm_source,utm_medium,utm_campaign',
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'listing_funnel_v'));

-- Acceso
select pg_temp.chk('anon no lee la vista', 'ERR:42501',
  pg_temp.intento('anon', null, 'select * from public.listing_funnel_v'));
select pg_temp.chk('vendedor no ve el embudo (RLS de funnel_events)', 'OK:0',
  pg_temp.intento('authenticated', :SELLER, 'select * from public.listing_funnel_v'));
select pg_temp.chk('admin lee la vista', 'OK:3',
  pg_temp.intento('authenticated', :ADMIN, 'select * from public.listing_funnel_v'));
-- La vista agrega (no es actualizable: 55000) y además authenticated solo tiene SELECT.
select pg_temp.chk('nadie escribe por la vista', 'ERR:55000',
  pg_temp.intento('authenticated', :ADMIN, 'delete from public.listing_funnel_v'));
select pg_temp.chk('authenticated: solo SELECT en la vista', 'SELECT',
  (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
    where table_name = 'listing_funnel_v' and grantee = 'authenticated'));
select pg_temp.chk('anon: ningún privilegio en la vista', '0',
  (select count(*)::text from information_schema.role_table_grants
    where table_name = 'listing_funnel_v' and grantee = 'anon'));
select pg_temp.chk('admin no escribe en funnel_events', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, $q$insert into public.funnel_events (event, is_test) values ('listing_paid', false)$q$));
select pg_temp.chk('authenticated no edita is_test', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, 'update public.funnel_events set is_test = false'));

-- Quien escribe tiene que decidir is_test
select pg_temp.chk('insert sin is_test falla (sin default)', 'ERR:23502',
  pg_temp.intento('service_role', null, $q$insert into public.funnel_events (event) values ('listing_paid')$q$));
select pg_temp.chk('service role inserta con is_test', 'OK:1',
  pg_temp.intento('service_role', null, $q$insert into public.funnel_events (event, is_test) values ('listing_paid', true)$q$));
select pg_temp.chk('metadata con forma de email sigue rechazada', 'ERR:23514',
  pg_temp.intento('service_role', null, $q$insert into public.funnel_events (event, is_test, metadata) values ('listing_paid', false, '{"x":"a@b.com"}')$q$));
\o

select caso, esperado, obtenido, case when esperado = obtenido then 'ok' else '*** FALLA' end as resultado
  from pg_temp.res order by orden;
do $$ begin
  if exists (select 1 from pg_temp.res where esperado is distinct from obtenido) then
    raise exception 'listing-funnel: hay casos que fallan';
  end if;
end $$;

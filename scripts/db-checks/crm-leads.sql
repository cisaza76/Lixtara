-- Casos de 20261012120000_crm_leads. Se corren DESPUÉS de aplicar la migración, en un
-- Postgres desechable (run-crm-leads.sh, con crm-leads-replica.sql) o en el Supabase
-- local (`supabase start`). NUNCA contra producción: siembra y borra datos.
--
-- Los casos se ejecutan con `SET LOCAL ROLE` + request.jwt.claim.sub, igual que PostgREST.
-- Sale con error si algún caso no coincide con lo esperado.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

-- Ejecuta `stmt` como `rol` (con `sub` como auth.uid()) y devuelve 'OK:<filas>' o 'ERR:<sqlstate>'.
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
create table pg_temp.res (orden serial, grupo text, caso text, esperado text, obtenido text);
create function pg_temp.chk(grupo text, caso text, esperado text, obtenido text) returns void
  language sql as $$ insert into pg_temp.res (grupo, caso, esperado, obtenido) values ($1, $2, $3, $4) $$;

-- ── Usuarios ────────────────────────────────────────────────────────────────────────
\set ADMIN '''11111111-1111-4111-8111-111111111111'''
\set BROKER '''22222222-2222-4222-8222-222222222222'''
\set PHOTO '''33333333-3333-4333-8333-333333333333'''
\set USER '''44444444-4444-4444-8444-444444444444'''
insert into auth.users (id) values (:ADMIN), (:BROKER), (:PHOTO), (:USER) on conflict do nothing;
insert into public.user_roles (user_id, role) values
  (:ADMIN, 'admin'), (:BROKER, 'broker'), (:PHOTO, 'photographer');

-- ── Siembra (como postgres, igual que el importador) ───────────────────────────────
-- c…01 enviable · c…02 listado activo · c…03 sin verificar · c…04 suprimido a mano
-- c…05 sin email · c…06 listado expirado (sí enviable) · c…07 listado activo ya vendido
-- c…10..c…19 para los casos de estado
insert into public.crm_owners (id, owner_key, owner_type, registered_name, email, email_verified_at,
                               pilot_group, priority, score, source, collected_on)
select ('cccccccc-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'ok-' || i,
       'Persona Natural', 'Owner ' || i,
       case when i = 5 then null else 'owner' || i || '@example.com' end,
       case when i = 3 then null else now() end,
       case when i % 2 = 0 then 'Score' else 'Control' end, 'A', 100 - i, 'test', current_date
  from generate_series(1, 19) i where i <= 7 or i >= 10;

insert into public.crm_properties (id, county, folio, mls_status, source, collected_on) values
  ('dddddddd-0000-4000-8000-000000000002', 'Miami-Dade', '0002', 'Activo', 'test', current_date),
  ('dddddddd-0000-4000-8000-000000000006', 'Miami-Dade', '0006', 'Expirado', 'test', current_date),
  ('dddddddd-0000-4000-8000-000000000007', 'Miami-Dade', '0007', 'Activo', 'test', current_date);
insert into public.crm_property_owners (property_id, owner_id, valid_to) values
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000002', null),
  ('dddddddd-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000006', null),
  ('dddddddd-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000007', current_date);
insert into public.crm_suppression (email, owner_id, reason, source)
  values ('owner4@example.com', 'cccccccc-0000-4000-8000-000000000004', 'manual', 'test');

-- Evento de outreach como lo escribe el webhook (service_role).
create function pg_temp.ev(n int, tipo text) returns void language plpgsql as $$
begin
  perform pg_temp.intento('service_role', null, format(
    $q$insert into public.crm_outreach (event_hash, provider, event_type, owner_id, email, payload, occurred_at)
       values (%L, 'instantly', %L, %L, %L, '{}'::jsonb, now())$q$,
    gen_random_uuid()::text, tipo,
    ('cccccccc-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
    'owner' || n || '@example.com'));
end $$;
-- plpgsql y no sql: en la imagen de Postgres de Supabase (17.6) crear esta función como
-- `language sql` en pg_temp tumba el backend (signal 11).
create function pg_temp.estado(n int) returns text language plpgsql as $$
begin
  return (select outreach_status from public.crm_owners
           where id = ('cccccccc-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid);
end $$;

-- ── Acceso ──────────────────────────────────────────────────────────────────────────
select pg_temp.chk('acceso', 'anon no lee crm_owners', 'ERR:42501',
  pg_temp.intento('anon', null, 'select * from public.crm_owners'));
select pg_temp.chk('acceso', 'anon no lee la vista de enviables', 'ERR:42501',
  pg_temp.intento('anon', null, 'select * from public.crm_sendable_email_owners'));
select pg_temp.chk('acceso', 'anon no lee crm_outreach', 'ERR:42501',
  pg_temp.intento('anon', null, 'select * from public.crm_outreach'));
-- Se mira el privilegio en vez de llamarla como anon: en la imagen local de Supabase
-- (Postgres 17.6, CLI 2.98) un "permission denied" de FUNCIÓN como anon tumba el backend.
select pg_temp.chk('acceso', 'anon no tiene EXECUTE sobre is_crm_admin()', 'false',
  has_function_privilege('anon', 'public.is_crm_admin()', 'execute')::text);
select pg_temp.chk('acceso', 'anon no tiene EXECUTE sobre crm_set_outreach_handled()', 'false',
  has_function_privilege('anon', 'public.crm_set_outreach_handled(uuid, boolean)', 'execute')::text);
select pg_temp.chk('acceso', 'usuario sin rol: crm_owners → 0 filas', 'OK:0',
  pg_temp.intento('authenticated', :USER, 'select * from public.crm_owners'));
select pg_temp.chk('acceso', 'usuario sin rol: vista de enviables → 0 filas', 'OK:0',
  pg_temp.intento('authenticated', :USER, 'select * from public.crm_sendable_email_owners'));
select pg_temp.chk('acceso', 'usuario sin rol: crm_properties → 0 filas', 'OK:0',
  pg_temp.intento('authenticated', :USER, 'select * from public.crm_properties'));
select pg_temp.chk('acceso', 'usuario sin rol: crm_suppression → 0 filas', 'OK:0',
  pg_temp.intento('authenticated', :USER, 'select * from public.crm_suppression'));
select pg_temp.chk('acceso', 'usuario sin rol no inserta propietarios', 'ERR:42501',
  pg_temp.intento('authenticated', :USER, $$insert into public.crm_owners
    (owner_key, owner_type, registered_name, source, collected_on)
    values ('x', 'LLC', 'x', 'x', current_date)$$));
select pg_temp.chk('acceso', 'fotógrafo: crm_owners → 0 filas', 'OK:0',
  pg_temp.intento('authenticated', :PHOTO, 'select * from public.crm_owners'));
select pg_temp.chk('acceso', 'admin lee todos los propietarios', 'OK:17',
  pg_temp.intento('authenticated', :ADMIN, 'select * from public.crm_owners'));
select pg_temp.chk('acceso', 'broker lee todos los propietarios', 'OK:17',
  pg_temp.intento('authenticated', :BROKER, 'select * from public.crm_owners'));
select pg_temp.chk('acceso', 'admin no puede TRUNCATE', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, 'truncate public.crm_owners cascade'));

-- ── Vista de enviables ──────────────────────────────────────────────────────────────
select pg_temp.chk('vista', 'enviables (admin): 01, 06, 07 y 10–19', '01,06,07,10,11,12,13,14,15,16,17,18,19',
  (select string_agg(right(id::text, 2), ',' order by id) from public.crm_sendable_email_owners));

-- ── Supresión ───────────────────────────────────────────────────────────────────────
select pg_temp.chk('supresión', 'broker inserta una supresión manual', 'OK:1',
  pg_temp.intento('authenticated', :BROKER, $$insert into public.crm_suppression (owner_id, reason, source)
    values ('cccccccc-0000-4000-8000-000000000001', 'manual', 'admin')$$));
select pg_temp.chk('supresión', '… y el propietario sale de la vista', '0',
  (select count(*)::text from public.crm_sendable_email_owners
    where id = 'cccccccc-0000-4000-8000-000000000001'));
select pg_temp.chk('supresión', 'staff no puede borrar la supresión', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, 'delete from public.crm_suppression'));
select pg_temp.chk('supresión', 'staff no puede actualizar la supresión', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, $$update public.crm_suppression set reason = 'manual'$$));
select pg_temp.chk('supresión', 'usuario sin rol no inserta supresiones', 'ERR:42501',
  pg_temp.intento('authenticated', :USER, $$insert into public.crm_suppression (email, reason, source)
    values ('x@example.com', 'manual', 'x')$$));
delete from public.crm_owners where id = 'cccccccc-0000-4000-8000-000000000004';
select pg_temp.chk('supresión', 'borrar al propietario NO borra su supresión (owner_id → null)', 'owner4@example.com|null',
  (select email || '|' || coalesce(owner_id::text, 'null') from public.crm_suppression
    where email = 'owner4@example.com'));

-- ── Webhook: lead_unsubscribed crea la supresión ────────────────────────────────────
select pg_temp.ev(10, 'lead_unsubscribed');
select pg_temp.chk('webhook', 'lead_unsubscribed → fila en crm_suppression', 'unsubscribe|all',
  (select reason || '|' || channel from public.crm_suppression where email = 'owner10@example.com'));
select pg_temp.chk('webhook', 'lead_unsubscribed → estado Baja', 'Baja', pg_temp.estado(10));
select pg_temp.chk('webhook', 'el de baja sale de la vista', '0',
  (select count(*)::text from public.crm_sendable_email_owners where id = 'cccccccc-0000-4000-8000-000000000010'));
select pg_temp.ev(11, 'email_bounced');
select pg_temp.chk('webhook', 'email_bounced → supresión solo de email', 'bounce|email',
  (select reason || '|' || channel from public.crm_suppression where email = 'owner11@example.com'));

-- ── crm_outreach: staff solo lee y marca gestionado ─────────────────────────────────
select pg_temp.chk('bandeja', 'staff no inserta eventos', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, $$insert into public.crm_outreach
    (event_hash, provider, event_type, payload, occurred_at) values ('h', 'x', 'x', '{}', now())$$));
select pg_temp.chk('bandeja', 'staff no edita columnas del evento', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, $$update public.crm_outreach set reply_text = 'x'$$));
select pg_temp.chk('bandeja', 'staff no borra eventos', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, 'delete from public.crm_outreach'));
select pg_temp.ev(12, 'reply_received');
select pg_temp.chk('bandeja', 'broker marca la respuesta como gestionada', 'OK:1',
  pg_temp.intento('authenticated', :BROKER, format('select public.crm_set_outreach_handled(%L, true)',
    (select id from public.crm_outreach where email = 'owner12@example.com'))));
select pg_temp.chk('bandeja', '… y queda handled_by = broker', '22222222-2222-4222-8222-222222222222',
  (select handled_by::text from public.crm_outreach where email = 'owner12@example.com' and handled_at is not null));
select pg_temp.chk('bandeja', 'usuario sin rol no puede marcar', 'ERR:42501',
  pg_temp.intento('authenticated', :USER, format('select public.crm_set_outreach_handled(%L, false)',
    (select id from public.crm_outreach where email = 'owner12@example.com'))));
select pg_temp.chk('bandeja', 'admin desmarca', 'OK:1',
  pg_temp.intento('authenticated', :ADMIN, format('select public.crm_set_outreach_handled(%L, false)',
    (select id from public.crm_outreach where email = 'owner12@example.com'))));
-- Sentencia aparte: dentro de la anterior, una subconsulta vería la foto de ANTES.
select pg_temp.chk('bandeja', '… y handled_at / handled_by vuelven a null', 'null|null',
  (select coalesce(handled_at::text, 'null') || '|' || coalesce(handled_by::text, 'null')
     from public.crm_outreach where email = 'owner12@example.com'));

-- ── Precedencia del estado ──────────────────────────────────────────────────────────
select pg_temp.ev(13, 'email_sent');
select pg_temp.chk('estado', 'Sin contactar + email_sent → Contactado', 'Contactado', pg_temp.estado(13));
select pg_temp.ev(13, 'reply_received');
select pg_temp.chk('estado', 'Contactado + reply_received → Respondió', 'Respondió', pg_temp.estado(13));
select pg_temp.ev(13, 'email_sent');
select pg_temp.chk('estado', 'Respondió + email_sent → sigue Respondió', 'Respondió', pg_temp.estado(13));

select pg_temp.ev(10, 'reply_received');
select pg_temp.chk('estado', 'Baja es terminal (reply_received)', 'Baja', pg_temp.estado(10));
select pg_temp.ev(10, 'lead_interested');
select pg_temp.chk('estado', 'Baja es terminal (lead_interested)', 'Baja', pg_temp.estado(10));
select pg_temp.ev(11, 'lead_interested');
select pg_temp.chk('estado', 'Rebote es terminal (lead_interested)', 'Rebote', pg_temp.estado(11));
select pg_temp.ev(14, 'lead_wrong_person');
select pg_temp.ev(14, 'email_sent');
select pg_temp.ev(14, 'lead_interested');
select pg_temp.chk('estado', 'Persona equivocada es terminal', 'Persona equivocada', pg_temp.estado(14));

select pg_temp.ev(15, 'lead_interested');
select pg_temp.ev(15, 'reply_received');
select pg_temp.chk('estado', 'Interesado no baja a Respondió', 'Interesado', pg_temp.estado(15));
select pg_temp.ev(15, 'email_sent');
select pg_temp.chk('estado', 'Interesado no baja a Contactado', 'Interesado', pg_temp.estado(15));
select pg_temp.ev(15, 'lead_unsubscribed');
select pg_temp.chk('estado', 'Interesado + lead_unsubscribed → Baja', 'Baja', pg_temp.estado(15));

select pg_temp.ev(16, 'lead_not_interested');
select pg_temp.ev(16, 'reply_received');
select pg_temp.chk('estado', 'No interesado no cambia con reply_received', 'No interesado', pg_temp.estado(16));
select pg_temp.ev(16, 'email_sent');
select pg_temp.chk('estado', 'No interesado no cambia con email_sent', 'No interesado', pg_temp.estado(16));
select pg_temp.ev(16, 'lead_unsubscribed');
select pg_temp.chk('estado', 'No interesado no cambia con lead_unsubscribed', 'No interesado', pg_temp.estado(16));
select pg_temp.ev(16, 'lead_interested');
select pg_temp.chk('estado', 'No interesado → Interesado (única salida)', 'Interesado', pg_temp.estado(16));
select pg_temp.chk('estado', '… pero sigue fuera de la vista (supresión not_interested)', '0',
  (select count(*)::text from public.crm_sendable_email_owners where id = 'cccccccc-0000-4000-8000-000000000016'));

select pg_temp.chk('estado', 'evento desconocido no cambia el estado', 'Sin contactar',
  (select public.crm_next_outreach_status('Sin contactar', null)));

-- ── Resultado ───────────────────────────────────────────────────────────────────────
\o
\pset footer off
select orden as "#", grupo, caso, esperado, obtenido,
       case when obtenido is not distinct from esperado then 'ok' else '*** FALLA ***' end as veredicto
  from pg_temp.res order by orden;
do $$ begin
  if exists (select 1 from pg_temp.res where obtenido is distinct from esperado) then
    raise exception 'HAY CASOS QUE NO COINCIDEN CON LO ESPERADO';
  end if;
end $$;
\echo 'crm-leads: todos los casos ok'

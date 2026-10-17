-- Casos de 20261017120000_terms_acceptances. Postgres desechable (run-terms-acceptances.sh,
-- con crm-leads-replica.sql + listing-funnel-replica.sql). NUNCA contra producción.
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
\set OTHER '''55555555-5555-4555-8555-555555555555'''
\set PROP '''aaaaaaaa-0000-4000-8000-000000000001'''
\set HASH '''0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'''
insert into auth.users (id) values (:ADMIN), (:SELLER), (:OTHER);
insert into public.user_roles (user_id, role) values (:ADMIN, 'admin');
insert into public.properties (id, owner_id) values (:PROP, :SELLER);

-- Escritura: solo el servidor.
select pg_temp.chk('service_role inserta la aceptación del paso 8', 'OK:1', pg_temp.intento('service_role', null, format(
  $q$insert into public.terms_acceptances (user_id, property_id, document, version, lang, consent_text_hash, context,
       stripe_checkout_session_id, ip_address, user_agent)
     values (%L, %L, 'terms_refund', '2026-10-16-draft', 'es', %L, 'checkout_tier', 'cs_test_abc123', '203.0.113.7', 'Mozilla/5.0')$q$,
  :SELLER, :PROP, :HASH)));
select pg_temp.chk('service_role inserta E-SIGN', 'OK:1', pg_temp.intento('service_role', null, format(
  $q$insert into public.terms_acceptances (user_id, property_id, document, version, lang, consent_text_hash, context)
     values (%L, %L, 'esign', '2026-10-16-draft', 'en', %L, 'step7_esign')$q$, :OTHER, :PROP, :HASH)));
select pg_temp.chk('el vendedor NO puede insertar (ni falsear su aceptación)', 'ERR:42501', pg_temp.intento('authenticated', :SELLER, format(
  $q$insert into public.terms_acceptances (user_id, document, version, lang, consent_text_hash, context)
     values (%L, 'terms_refund', 'x', 'es', %L, 'checkout_tier')$q$, :SELLER, :HASH)));
select pg_temp.chk('anon no puede leer', 'ERR:42501', pg_temp.intento('anon', null, 'select 1 from public.terms_acceptances'));

-- Lectura.
select pg_temp.chk('el vendedor ve solo sus filas', 'OK:1', pg_temp.intento('authenticated', :SELLER, 'select 1 from public.terms_acceptances'));
select pg_temp.chk('admin ve todas', 'OK:2', pg_temp.intento('authenticated', :ADMIN, 'select 1 from public.terms_acceptances'));

-- Solo inserción.
select pg_temp.chk('nadie edita (ni service_role)', 'ERR:42501', pg_temp.intento('service_role', null,
  $q$update public.terms_acceptances set version = 'otra'$q$));
select pg_temp.chk('nadie borra (ni service_role)', 'ERR:42501', pg_temp.intento('service_role', null,
  'delete from public.terms_acceptances'));
select pg_temp.chk('el vendedor tampoco edita', 'ERR:42501', pg_temp.intento('authenticated', :SELLER,
  $q$update public.terms_acceptances set lang = 'en'$q$));

-- Validaciones.
select pg_temp.chk('hash que no es SHA-256 hex → rechazo', 'ERR:23514', pg_temp.intento('service_role', null,
  $q$insert into public.terms_acceptances (document, version, lang, consent_text_hash, context) values ('terms_refund','v','es','abc','checkout_tier')$q$));
select pg_temp.chk('documento desconocido → rechazo', 'ERR:23514', pg_temp.intento('service_role', null, format(
  $q$insert into public.terms_acceptances (document, version, lang, consent_text_hash, context) values ('otro','v','es',%L,'x')$q$, :HASH)));
select pg_temp.chk('idioma fuera de en/es → rechazo', 'ERR:23514', pg_temp.intento('service_role', null, format(
  $q$insert into public.terms_acceptances (document, version, lang, consent_text_hash, context) values ('esign','v','fr',%L,'x')$q$, :HASH)));

-- Borrar el usuario o la propiedad conserva la prueba (ids en NULL).
delete from public.properties where id = :PROP;
select pg_temp.chk('borrar la propiedad: la prueba queda, property_id NULL', '2:0',
  (select count(*) || ':' || count(property_id) from public.terms_acceptances));
delete from auth.users where id = :SELLER;
select pg_temp.chk('borrar el usuario: la prueba queda, user_id NULL', '2:1',
  (select count(*) || ':' || count(user_id) from public.terms_acceptances));

\o
\pset footer off
select orden as "#", caso, esperado, obtenido,
       case when obtenido is not distinct from esperado then 'ok' else '*** FALLA ***' end as veredicto
  from pg_temp.res order by orden;
do $$ begin
  if exists (select 1 from pg_temp.res where obtenido is distinct from esperado) then
    raise exception 'HAY CASOS QUE NO COINCIDEN CON LO ESPERADO';
  end if;
end $$;
\echo 'terms-acceptances: todos los casos ok'

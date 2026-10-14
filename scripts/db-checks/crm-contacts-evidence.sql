-- Casos de 20261013235500_crm_contacts_evidence. Se corren DESPUÉS de aplicar las migraciones del
-- CRM, en un Postgres desechable (run-crm-contacts-evidence.sh). NUNCA contra producción.
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
create table pg_temp.res (orden serial, grupo text, caso text, esperado text, obtenido text);
create function pg_temp.chk(grupo text, caso text, esperado text, obtenido text) returns void
  language sql as $$ insert into pg_temp.res (grupo, caso, esperado, obtenido) values ($1, $2, $3, $4) $$;

\set ADMIN '''11111111-1111-4111-8111-111111111111'''
\set USER '''44444444-4444-4444-8444-444444444444'''
insert into auth.users (id) values (:ADMIN), (:USER) on conflict do nothing;
insert into public.user_roles (user_id, role) values (:ADMIN, 'admin');

-- Propietarios: o1 (contacto activable), o2 (sin SMTP), o3 (suprimido), o4 (elegibilidad revocada)
insert into public.crm_owners (id, owner_key, owner_type, registered_name, source, collected_on)
select ('eeeeeeee-0000-4000-8000-00000000000' || i)::uuid, 'ev-' || i, 'Persona Natural', 'Owner ' || i, 'test', current_date
  from generate_series(1, 5) i;
insert into public.crm_contacts (id, owner_id, type, value, source) values
  ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'email', 'a1@example.com', 'test'),
  ('ffffffff-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000002', 'email', 'a2@example.com', 'test'),
  ('ffffffff-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000003', 'email', 'a3@example.com', 'test'),
  ('ffffffff-0000-4000-8000-000000000004', 'eeeeeeee-0000-4000-8000-000000000004', 'email', 'a4@example.com', 'test'),
  ('ffffffff-0000-4000-8000-000000000005', 'eeeeeeee-0000-4000-8000-000000000005', 'email', 'b5@example.com', 'test');
insert into public.crm_identity_evidence (contact_id, class, rule, rules_version)
select ('ffffffff-0000-4000-8000-00000000000' || i)::uuid, case when i = 5 then 'B' else 'A' end, 'test', 't' from generate_series(1, 5) i;
insert into public.crm_contact_validations (contact_id, status, method, checked_at)
select ('ffffffff-0000-4000-8000-00000000000' || i)::uuid, case when i = 2 then 'mx_ok' else 'valid' end, 'test', now()
  from generate_series(1, 5) i;
insert into public.crm_contact_eligibility (contact_id, eligible, basis)
select ('ffffffff-0000-4000-8000-00000000000' || i)::uuid, true, 'test' from generate_series(1, 5) i;
insert into public.crm_contact_eligibility (contact_id, eligible, basis)
  values ('ffffffff-0000-4000-8000-000000000004', false, 'revocada');            -- última fila manda
insert into public.crm_suppression (email, reason, source) values ('a3@example.com', 'unsubscribe', 'test');

-- ── Vista activable ────────────────────────────────────────────────────────────────
select pg_temp.chk('activable', 'solo A + elegible + valid + no suprimido', 'a1@example.com',
  (select string_agg(value, ',' order by value) from public.crm_contacts_activable));
select pg_temp.chk('activable', 'current toma la ÚLTIMA elegibilidad', 'false',
  (select eligible::text from public.crm_contacts_current where id = 'ffffffff-0000-4000-8000-000000000004'));
insert into public.crm_suppression (owner_id, reason, source)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'manual', 'test');
select pg_temp.chk('activable', 'supresión por owner_id también excluye', '0',
  (select count(*)::text from public.crm_contacts_activable));

-- ── Acceso ─────────────────────────────────────────────────────────────────────────
select pg_temp.chk('acceso', 'anon no lee crm_contacts', 'ERR:42501',
  pg_temp.intento('anon', null, 'select * from public.crm_contacts'));
select pg_temp.chk('acceso', 'anon no lee la vista activable', 'ERR:42501',
  pg_temp.intento('anon', null, 'select * from public.crm_contacts_activable'));
select pg_temp.chk('acceso', 'usuario sin rol ve 0 contactos', 'OK:0',
  pg_temp.intento('authenticated', :USER, 'select * from public.crm_contacts'));
select pg_temp.chk('acceso', 'admin ve los 5 contactos', 'OK:5',
  pg_temp.intento('authenticated', :ADMIN, 'select * from public.crm_contacts'));
select pg_temp.chk('acceso', 'admin inserta evidencia', 'OK:1',
  pg_temp.intento('authenticated', :ADMIN, $q$insert into public.crm_identity_evidence (contact_id, class, rule, rules_version)
     values ('ffffffff-0000-4000-8000-000000000005', 'C', 'reclasificado', 't2')$q$));
select pg_temp.chk('acceso', 'usuario sin rol no inserta contactos', 'ERR:42501',
  pg_temp.intento('authenticated', :USER, $q$insert into public.crm_contacts (owner_id, type, value, source)
     values ('eeeeeeee-0000-4000-8000-000000000001', 'email', 'x@example.com', 'test')$q$));
select pg_temp.chk('acceso', 'admin no inserta experimentos (los escribe el pipeline)', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, $q$insert into public.crm_experiments (id, name, channel, seed, strata, population)
     values ('x', 'x', 'email', 1, 'x', 0)$q$));
select pg_temp.chk('acceso', 'la vista de estado vigente no admite escritura', 'ERR:55000',
  pg_temp.intento('authenticated', :ADMIN, $q$delete from public.crm_contacts_current$q$));

-- ── Inmutabilidad (también para service_role) ─────────────────────────────────────
select pg_temp.chk('inmutable', 'admin no actualiza contactos (sin privilegio)', 'ERR:42501',
  pg_temp.intento('authenticated', :ADMIN, $q$update public.crm_contacts set value = 'z@example.com'$q$));
select pg_temp.chk('inmutable', 'service_role no cambia el valor de un contacto', 'ERR:P0001',
  pg_temp.intento('service_role', null, $q$update public.crm_contacts set value = 'z@example.com'
     where id = 'ffffffff-0000-4000-8000-000000000001'$q$));
select pg_temp.chk('inmutable', 'service_role sí puede vincular la persona (person_id)', 'OK:1',
  pg_temp.intento('service_role', null, $q$update public.crm_contacts set country = 'US'
     where id = 'ffffffff-0000-4000-8000-000000000001'$q$));
select pg_temp.chk('inmutable', 'service_role no borra contactos', 'ERR:P0001',
  pg_temp.intento('service_role', null, $q$delete from public.crm_contacts where id = 'ffffffff-0000-4000-8000-000000000005'$q$));
select pg_temp.chk('inmutable', 'service_role no edita evidencia', 'ERR:P0001',
  pg_temp.intento('service_role', null, $q$update public.crm_identity_evidence set class = 'A'$q$));
select pg_temp.chk('inmutable', 'service_role no borra elegibilidad', 'ERR:P0001',
  pg_temp.intento('service_role', null, $q$delete from public.crm_contact_eligibility$q$));
select pg_temp.chk('inmutable', 'borrar un propietario con contactos falla', 'ERR:23503',
  pg_temp.intento('service_role', null, $q$delete from public.crm_owners where id = 'eeeeeeee-0000-4000-8000-000000000002'$q$));
select pg_temp.chk('inmutable', 'email en mayúsculas rechazado', 'ERR:23514',
  pg_temp.intento('service_role', null, $q$insert into public.crm_contacts (owner_id, type, value, source)
     values ('eeeeeeee-0000-4000-8000-000000000001', 'email', 'Mixed@Example.com', 'test')$q$));
select pg_temp.chk('inmutable', 'mismo (propietario, tipo, valor) no se duplica', 'ERR:23505',
  pg_temp.intento('service_role', null, $q$insert into public.crm_contacts (owner_id, type, value, source)
     values ('eeeeeeee-0000-4000-8000-000000000001', 'email', 'a1@example.com', 'otra')$q$));

-- ── Experimentos ───────────────────────────────────────────────────────────────────
insert into public.crm_experiments (id, name, channel, seed, strata, population)
  values ('exp-test', 'test', 'email', 20261013, 'barrio x tercil', 2);
insert into public.crm_experiment_assignments (experiment_id, owner_id, stratum, arm) values
  ('exp-test', 'eeeeeeee-0000-4000-8000-000000000001', 'B|T1', 'Score'),
  ('exp-test', 'eeeeeeee-0000-4000-8000-000000000002', 'B|T1', 'Control');
select pg_temp.chk('experimento', 'un propietario no se asigna dos veces', 'ERR:23505',
  pg_temp.intento('service_role', null, $q$insert into public.crm_experiment_assignments values
     ('exp-test', 'eeeeeeee-0000-4000-8000-000000000001', 'B|T1', 'Control', now())$q$));
select pg_temp.chk('experimento', 'no se cambia el brazo', 'ERR:P0001',
  pg_temp.intento('service_role', null, $q$update public.crm_experiment_assignments set arm = 'Control'$q$));
select pg_temp.chk('experimento', 'no se cambia la seed', 'ERR:P0001',
  pg_temp.intento('service_role', null, $q$update public.crm_experiments set seed = 1$q$));
select pg_temp.chk('experimento', 'brazo inválido rechazado', 'ERR:23514',
  pg_temp.intento('service_role', null, $q$insert into public.crm_experiment_assignments values
     ('exp-test', 'eeeeeeee-0000-4000-8000-000000000003', 'B|T1', 'Otro', now())$q$));

-- ── Privilegios residuales ────────────────────────────────────────────────────────
select pg_temp.chk('grants', 'anon: ningún privilegio en las tablas y vistas nuevas', '0',
  (select count(*)::text from information_schema.role_table_grants where grantee = 'anon'
     and table_name in ('crm_persons','crm_entity_persons','crm_contacts','crm_identity_evidence',
                        'crm_contact_validations','crm_contact_eligibility','crm_experiments',
                        'crm_experiment_assignments','crm_contacts_current','crm_contacts_activable')));
select pg_temp.chk('grants', 'authenticated: sin UPDATE/DELETE/TRUNCATE en las nuevas', '0',
  (select count(*)::text from information_schema.role_table_grants where grantee = 'authenticated'
     and privilege_type in ('UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
     and table_name in ('crm_persons','crm_entity_persons','crm_contacts','crm_identity_evidence',
                        'crm_contact_validations','crm_contact_eligibility','crm_experiments',
                        'crm_experiment_assignments','crm_contacts_current','crm_contacts_activable')));
select pg_temp.chk('grants', 'RLS activa en las 8 tablas nuevas', '8',
  (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity and c.relname in
      ('crm_persons','crm_entity_persons','crm_contacts','crm_identity_evidence','crm_contact_validations',
       'crm_contact_eligibility','crm_experiments','crm_experiment_assignments')));

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
\echo 'crm-contacts-evidence: todos los casos ok'

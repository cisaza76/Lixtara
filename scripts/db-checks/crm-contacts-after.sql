-- Verificación de la carga de contactos (ver crm-contacts-before.sql). Sigue dentro de la
-- transacción abierta allá; termina con ROLLBACK.
create temp table cres (orden serial, caso text, esperado text, obtenido text) on commit drop;

-- Resultado por fila del CSV.
insert into cres (caso, esperado, obtenido)
select 'fila ' || e.row_no || ' (' || coalesce(e.owner_key, '∅') || ')', x.esperado, e.outcome
  from stg_contacts_eval e
  join (values
    (2, 'loaded_valid'), (3, 'kept_verified'), (4, 'demoted'), (5, 'kept_suppressed_current'),
    (6, 'skipped_suppressed_new'), (7, 'reverified'), (8, 'rejected_risky'),
    (9, 'skipped_email_taken'), (10, 'duplicate_owner_in_file'), (11, 'duplicate_owner_in_file'),
    (12, 'duplicate_email_in_file'), (13, 'duplicate_email_in_file'), (14, 'unknown_owner'),
    (15, 'bad_status'), (16, 'bad_email'), (17, 'missing_source'), (18, 'loaded_valid'),
    (19, 'rejected_invalid'), (20, 'loaded_unverified'), (21, 'duplicate_owner_in_file'),
    (22, 'recorded_only'), (23, 'recorded_only'), (24, 'missing_evidence'), (25, 'rejected_invalid')
  ) as x(row_no, esperado) on x.row_no = e.row_no;
insert into cres (caso, esperado, obtenido)
  values ('todas las filas evaluadas', '24', (select count(*)::text from stg_contacts_eval));

-- Estado final de cada propietario: email | verificado
create function pg_temp.st(k text) returns text language plpgsql as $$
begin
  return (select coalesce(email, '∅') || '|' || (email_verified_at is not null)::text
            from public.crm_owners where owner_key = k);
end $$;
insert into cres (caso, esperado, obtenido) values
  ('valid → cargado y verificado', 'new1@example.com|true', pg_temp.st('ct-1')),
  ('unknown no pisa un email verificado', 'old2@example.com|true', pg_temp.st('ct-2')),
  ('invalid sobre el email actual → desmarcado (aunque ct-3 venga repetido)', 'cur3@example.com|false', pg_temp.st('ct-3')),
  ('NUNCA sobrescribe un email suprimido', 'sup4@example.com|true', pg_temp.st('ct-4')),
  ('nunca carga un email suprimido', '∅|false', pg_temp.st('ct-5')),
  ('valid sobre el mismo email sin verificar → verificado', 'u6@example.com|true', pg_temp.st('ct-6')),
  ('risky no se carga', '∅|false', pg_temp.st('ct-7')),
  ('email de otro propietario no se carga', '∅|false', pg_temp.st('ct-8')),
  ('owner_key repetido → nada', '∅|false', pg_temp.st('ct-9')),
  ('email repetido (mayúsculas) → nada', '∅|false', pg_temp.st('ct-10')),
  ('estado desconocido → nada', '∅|false', pg_temp.st('ct-12')),
  ('email mal formado → nada', '∅|false', pg_temp.st('ct-13')),
  ('sin email_source → nada', '∅|false', pg_temp.st('ct-14')),
  ('email y estado se normalizan (trim, minúsculas)', 'mixed@example.com|true', pg_temp.st('ct-15')),
  ('invalid sin email actual → nada', '∅|false', pg_temp.st('ct-16')),
  ('unknown → cargado SIN verificar', 'un17@example.com|false', pg_temp.st('ct-17')),
  ('email_source queda guardado', 'tracer',
    (select email_source from public.crm_owners where owner_key = 'ct-1'));

-- Historial (migración 20261013235500): contactos, evidencia, validación y elegibilidad.
create function pg_temp.ct(k text) returns text language plpgsql as $$
begin
  return (select coalesce(string_agg(c.value || ':' || cc.class || ':' || cc.validation_status || ':' ||
                                     cc.eligible::text, ',' order by c.value), '∅')
            from public.crm_contacts c join public.crm_owners o on o.id = c.owner_id
            join public.crm_contacts_current cc on cc.id = c.id
           where o.owner_key = k);
end $$;
insert into cres (caso, esperado, obtenido) values
  ('B elegible=false: registrado, crm_owners intacto', 'b18@example.com:B:valid:false', pg_temp.ct('ct-18')),
  ('… y no llega a crm_owners', '∅|false', pg_temp.st('ct-18')),
  ('A no elegible: registrado, no enviable', 'a19@example.com:A:valid:false', pg_temp.ct('ct-19')),
  ('… y no llega a crm_owners', '∅|false', pg_temp.st('ct-19')),
  ('sin regla de identidad: no se registra nada', '∅', pg_temp.ct('ct-20')),
  ('C invalid: se registra con su validación', 'c21@example.com:C:invalid:false', pg_temp.ct('ct-21')),
  ('owner_key repetido: se registran ambos contactos', 'x9@example.com:A:valid:true,y9@example.com:A:valid:true', pg_temp.ct('ct-9')),
  ('email suprimido: se registra (historial) aunque no se cargue', 'blocked5@example.com:A:valid:true', pg_temp.ct('ct-5')),
  ('propietario inexistente: nada', '0', (select count(*)::text from public.crm_contacts where value = 'ghost@example.com')),
  ('evidencia jsonb guardada', 'true', (select (evidence ->> 'mx') from public.crm_identity_evidence e
     join public.crm_contacts c on c.id = e.contact_id where c.value = 'b18@example.com')),
  ('método y fecha de validación', 'smtp:test|2026-10-13', (select v.method || '|' || to_char(v.checked_at at time zone 'UTC', 'YYYY-MM-DD')
     from public.crm_contact_validations v join public.crm_contacts c on c.id = v.contact_id where c.value = 'b18@example.com')),
  ('método por defecto = import:<fuente>', 'import:tracer', (select v.method from public.crm_contact_validations v
     join public.crm_contacts c on c.id = v.contact_id where c.value = 'new1@example.com')),
  ('ledger_ref guardado', 'L22', (select ledger_ref from public.crm_contacts where value = 'b18@example.com'));

-- Conteos para la re-ejecución (crm-contacts-rerun.sql)
create temp table hist_before on commit drop as
select (select count(*) from public.crm_contacts) c, (select count(*) from public.crm_identity_evidence) e,
       (select count(*) from public.crm_contact_validations) v, (select count(*) from public.crm_contact_eligibility) g;

-- Lo que importa al final: quién queda enviable.
insert into cres (caso, esperado, obtenido) values
  ('enviables tras la carga: ct-1, ct-15, ct-2, ct-6', 'ct-1,ct-15,ct-2,ct-6',
    (select string_agg(owner_key, ',' order by owner_key) from public.crm_sendable_email_owners
      where owner_key like 'ct-%'));

\pset footer off
select orden as "#", caso, esperado, obtenido,
       case when obtenido is not distinct from esperado then 'ok' else '*** FALLA ***' end as veredicto
  from cres order by orden;
do $$ begin
  if exists (select 1 from cres where obtenido is distinct from esperado) then
    raise exception 'HAY CASOS DE CONTACTOS QUE NO COINCIDEN CON LO ESPERADO';
  end if;
end $$;
\echo 'crm-contacts: todos los casos ok'
-- Sigue en crm-contacts-rerun.sql (misma transacción): re-ejecuta la carga y termina con ROLLBACK.
drop table stg_contacts_eval;
drop table stg_contacts_rec;

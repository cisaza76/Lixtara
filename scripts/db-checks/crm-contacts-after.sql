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
    (19, 'rejected_invalid'), (20, 'loaded_unverified'), (21, 'duplicate_owner_in_file')
  ) as x(row_no, esperado) on x.row_no = e.row_no;
insert into cres (caso, esperado, obtenido)
  values ('todas las filas evaluadas', '20', (select count(*)::text from stg_contacts_eval));

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
rollback;

-- Re-ejecución de scripts/sql/crm_import_contacts.sql con el MISMO CSV (sigue la transacción de
-- crm-contacts-before/after.sql): el historial no debe crecer. Termina con ROLLBACK.
\pset footer off
select 'crm-contacts rerun' as caso,
       (select count(*) from public.crm_contacts) - h.c as contactos_nuevos,
       (select count(*) from public.crm_identity_evidence) - h.e as evidencias_nuevas,
       (select count(*) from public.crm_contact_validations) - h.v as validaciones_nuevas,
       (select count(*) from public.crm_contact_eligibility) - h.g as elegibilidades_nuevas
  from hist_before h;
do $$ declare d int; begin
  select ((select count(*) from public.crm_contacts) - c) + ((select count(*) from public.crm_identity_evidence) - e)
       + ((select count(*) from public.crm_contact_validations) - v) + ((select count(*) from public.crm_contact_eligibility) - g)
    into d from hist_before;
  if d <> 0 then raise exception 'la re-ejecución agregó % filas de historial', d; end if;
end $$;
\echo 'crm-contacts rerun: 0 filas nuevas de historial (idempotente)'
rollback;

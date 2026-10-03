-- Rollback de 20260927120000_guard_properties_mls_status.sql — DESACTIVA, NO BORRA.
--
-- Apaga los dos triggers nuevos y nada más:
--   guard_properties_seller_columns  (lista de columnas permitidas del vendedor)
--   log_property_status_change       (historial de estado)
--
-- Se CONSERVA todo:
--   - property_status_history y sus filas (queda sin nuevas inserciones mientras esté apagado);
--   - properties.is_test y sus valores (el código desplegado la lee: no se puede quitar);
--   - las políticas nuevas de lectura pública (excluyen is_test) y de INSERT en payments /
--     agreements (solo estado inicial) — son compatibles con el código actual y cerrarlas
--     de nuevo sería reabrir la falsificación de pagos y firmas.
--
-- ⚠️ Con los triggers apagados vuelve el hueco original: un vendedor puede poner su listing
-- en `active`, cambiar su tier pagado o su mls_number, y esos cambios no quedan en el
-- historial. Solo para cortar un fallo en producción; reactivar cuanto antes con:
--
--   alter table public.properties enable trigger guard_properties_seller_columns;
--   alter table public.properties enable trigger log_property_status_change;
--
-- Probado en Postgres desechable: pnpm db-check:mls-status-guard (fase "ROLLBACK").
-- Comando exacto: docs/superpowers/runbooks/2026-09-27-despliegue-133-guard-vendedor.md

begin;
alter table public.properties disable trigger guard_properties_seller_columns;
alter table public.properties disable trigger log_property_status_change;
commit;

-- Verificación (debe mostrar ambos con tgenabled = 'D'):
select tgname, tgenabled from pg_trigger
 where tgrelid = 'public.properties'::regclass
   and tgname in ('guard_properties_seller_columns', 'log_property_status_change')
 order by tgname;

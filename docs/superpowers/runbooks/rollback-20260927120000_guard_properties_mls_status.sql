-- Rollback de 20260927120000_guard_properties_mls_status.sql
--
-- ⚠️ Reabre el hueco: con la política "Users can update own properties", un vendedor vuelve
-- a poder poner su propio listing en `active` (o insertarlo así) sin aprobación del broker.
-- Solo para revertir un despliegue roto, y reaplicar cuanto antes.

begin;
drop trigger if exists guard_properties_mls_status on public.properties;
drop function if exists public.guard_properties_mls_status();
commit;

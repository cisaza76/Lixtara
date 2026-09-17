-- Rollback de 20260916140000_mls_idx_feed.sql
--
-- DESTRUCTIVO: elimina todo el contenido licenciado del MLS almacenado localmente.
-- Eso es exactamente lo que § VI.C del acuerdo de MIAMI exige al terminar el acuerdo
-- ("remove and destroy any copies of the Licensed Content in its possession, including
-- backups"), con confirmación por escrito a MIAMI dentro de 10 días.
--
-- ⚠️ DROP no alcanza los backups PITR de Supabase. Si este rollback se ejecuta para
-- cumplir § VI.C y no por un error de despliegue, hay que coordinar además la purga o
-- expiración de los backups con Supabase, y dejarlo registrado en el expediente.

drop table if exists public.mls_sync_state;
drop table if exists public.mls_listings;

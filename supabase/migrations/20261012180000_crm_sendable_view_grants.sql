-- La vista crm_sendable_email_owners heredó los privilegios por defecto de Supabase para
-- `authenticated` (ALL: INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER). 20261012120000
-- endureció las 8 tablas crm_* pero de la vista solo revocó anon.
--
-- La vista es auto-actualizable y security_invoker: un usuario sin rol no podía escribir por
-- ella (la RLS de crm_owners lo bloquea, 0 filas) y el staff solo podía hacer lo mismo que ya
-- puede directo sobre crm_owners. No había escalada; esto la deja de solo lectura, como se
-- diseñó: el envío solo LEE de ella.
--
-- Hallado al verificar 20261012120000 en producción (2026-10-12). Idempotente.

revoke insert, update, delete, truncate, references, trigger
  on public.crm_sendable_email_owners from authenticated;

-- Reversión de 20261017120000_terms_acceptances. Correr a mano, con OK del owner.
-- Revertir PRIMERO el código: el código nuevo exige registrar la aceptación antes de pagar
-- y de abrir DocuSign; sin la tabla, esos pasos fallan cerrados.
-- ⚠️ Borra la prueba de todas las aceptaciones registradas. Exportarlas antes si existen:
--    \copy (select * from public.terms_acceptances) to 'terms_acceptances_backup.csv' csv header
drop trigger if exists terms_acceptances_append_only on public.terms_acceptances;
drop table if exists public.terms_acceptances;
drop function if exists public.terms_acceptances_append_only();

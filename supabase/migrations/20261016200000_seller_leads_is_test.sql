-- =============================================================================
-- seller_leads.is_test: las pruebas de Preview dejan de mezclarse con los leads reales.
--
-- Preview usa esta misma base. Cada correo confirmado en el paso 1 de una preview creaba
-- una fila real en seller_leads, visible en /admin/seller-leads de producción. Desde este
-- cambio el servidor marca is_test = true cuando VERCEL_ENV no es 'production'
-- (src/lib/listing-email-gate.server.ts) y el admin las oculta por defecto.
--
-- Default false: el código que hoy está en producción (no conoce la columna) sigue
-- insertando sin cambios, así que esta migración se puede aplicar ANTES del deploy.
-- Filas existentes: se marcan como prueba solo las ligadas a una propiedad is_test = true.
-- Las demás pruebas antiguas quedan en false hasta que alguien las marque a mano.
-- Sin datos personales nuevos. Sin cambios de RLS ni de grants.
-- Reversión: scripts/sql/rollback_20261016200000_seller_leads_is_test.sql
-- =============================================================================

alter table public.seller_leads add column if not exists is_test boolean not null default false;

comment on column public.seller_leads.is_test is
  'true = lead de prueba (escrito fuera de Production o ligado a una propiedad is_test). /admin/seller-leads lo oculta por defecto.';

update public.seller_leads l
   set is_test = true
  from public.properties p
 where p.id = l.property_id
   and p.is_test
   and not l.is_test;

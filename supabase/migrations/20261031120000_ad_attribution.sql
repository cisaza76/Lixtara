-- =============================================================================
-- ad_attribution: identificadores de publicidad de cada usuario para la API de
-- Conversiones de Meta (decisión del owner 2026-10-31; plan de medición del CMO, paso 4.8).
--
-- La firma del contrato puede llegar por el webhook de DocuSign y el pago por el de Stripe,
-- sin el navegador de la persona (sin sus cookies). Por eso el servidor guarda aquí, al
-- verificar el correo del paso 1, al retomar el registro y al abrir el Checkout:
--   * ads_consent: 'granted' o 'denied' (la categoría Publicidad del aviso de cookies; con
--     Global Privacy Control cuenta como 'denied');
--   * SOLO con 'granted': fbp y fbc (cookies _fbp/_fbc de Meta), IP (primer valor de
--     x-forwarded-for) y user agent.
-- Con 'denied' las cuatro columnas quedan vacías (check). Nada del inmueble ni del listing,
-- ni nombre, ni correo, ni teléfono.
--
-- Acceso: RLS activa SIN políticas y sin permisos para anon/authenticated: solo el servidor
-- (service_role). Una fila por usuario; se borra con el usuario.
--
-- Idempotente. Reversión: scripts/sql/rollback_20261031120000_ad_attribution.sql.
-- Verificación sin producción: pnpm db-check:ad-attribution (PGlite).
-- NO APLICADA: aplicar SOLO con sign-off explícito del owner (`supabase db push`).
-- =============================================================================

create table if not exists public.ad_attribution (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ads_consent text not null check (ads_consent in ('granted', 'denied')),
  fbp text check (fbp is null or length(fbp) <= 64),
  fbc text check (fbc is null or length(fbc) <= 512),
  client_ip text check (client_ip is null or length(client_ip) <= 45),
  client_ua text check (client_ua is null or length(client_ua) <= 512),
  updated_at timestamptz not null default now(),
  constraint ad_attribution_only_with_consent check (
    ads_consent = 'granted'
    or (fbp is null and fbc is null and client_ip is null and client_ua is null)
  )
);

comment on table public.ad_attribution is
  'Meta Conversions API identifiers per user (fbp, fbc, IP, user agent), only with Advertising consent. Server-only (service_role).';

alter table public.ad_attribution enable row level security;
revoke all on table public.ad_attribution from public, anon, authenticated;
grant select, insert, update, delete on table public.ad_attribution to service_role;

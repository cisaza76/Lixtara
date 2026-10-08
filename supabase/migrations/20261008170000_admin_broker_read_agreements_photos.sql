-- Admin/broker pueden LEER los acuerdos y las fotos de cualquier listing.
--
-- Por qué: `agreements` solo tenía "own agreements select" (auth.uid() = owner_id) y
-- `property_photos` solo dejaba ver al dueño, o al público si el listing está ACTIVO.
-- La revisión del admin (/admin/listings/[id]/review) leía con la sesión del staff y
-- recibía cero filas en silencio: "No listing agreement on file" y sin fotos en los
-- borradores, aunque el vendedor sí había firmado y subido fotos (reportado 2026-10-08).
-- Mientras tanto la página lee esas dos tablas con la secret key tras verificar el rol
-- (PR #150); con esta migración puede volver a usar la sesión del staff.
--
-- Solo SELECT. Escrituras: sin cambios (las hace el servidor con la secret key).
-- La política vieja "Brokers can manage all agreements" es de la tabla LEGACY
-- `listing_agreements`, no de `agreements`.
--
-- Idempotente. NO APLICADA: aplicar solo con sign-off explícito del owner (`supabase db push`).

drop policy if exists "staff read agreements" on public.agreements;
create policy "staff read agreements" on public.agreements
  for select to authenticated
  using (public.is_admin_or_broker());

drop policy if exists "staff read property photos" on public.property_photos;
create policy "staff read property photos" on public.property_photos
  for select to authenticated
  using (public.is_admin_or_broker());

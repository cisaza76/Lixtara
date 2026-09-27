-- Rollback de 20260927120000_guard_properties_mls_status.sql
--
-- ⚠️ Reabre los huecos: con la política "Users can update own properties" un vendedor vuelve
-- a poder poner su listing en `active`, cambiar su tier ya pagado o su mls_number; y con las
-- políticas de INSERT originales, a crear su propio pago "succeeded" o acuerdo "signed".
-- Solo para revertir un despliegue roto, y reaplicar cuanto antes.
--
-- Antes de ejecutarlo: desplegar un código anterior a esta migración — lib/properties.ts y
-- /api/offers leen `is_test`, que este rollback elimina.
--
-- NO borra property_status_history: el historial se conserva (renombrado) como evidencia.

begin;

drop trigger if exists log_property_status_change on public.properties;
drop function if exists public.log_property_status_change();
drop trigger if exists guard_properties_seller_columns on public.properties;
drop function if exists public.guard_properties_seller_columns();
drop function if exists public.properties_seller_writable_columns();

alter table if exists public.property_status_history
  rename to property_status_history_rolled_back;

drop policy if exists "own payments insert" on public.payments;
create policy "own payments insert" on public.payments
  for insert to public with check (auth.uid() = user_id);
drop policy if exists "own agreements insert" on public.agreements;
create policy "own agreements insert" on public.agreements
  for insert to public with check (auth.uid() = owner_id);

drop policy if exists "Public can view active listings" on public.properties;
create policy "Public can view active listings" on public.properties
  for select to public using (mls_status = 'active');
drop policy if exists "properties_public_read_active" on public.properties;
create policy "properties_public_read_active" on public.properties
  for select to anon, authenticated using (mls_status = 'active');

alter table public.properties drop column if exists is_test;

commit;

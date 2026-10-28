-- Reversión de 20261028120000_listing_signers (#220). Correr a mano, con OK del owner.
-- Revertir PRIMERO el código que lee o escribe listing_ownership, listing_additional_signers o
-- las columnas nuevas de agreements (paso 3, /api/agreement/create, webhook, cron, admin): sin
-- ellas, ese código falla.
-- ⚠️ Borra el titular y el segundo firmante de todos los listings, y el estado de la segunda firma
-- y del plazo de cada acuerdo. Exportarlos antes si existen:
--    \copy (select * from public.listing_ownership) to 'listing_ownership_backup.csv' csv header
--    \copy (select * from public.listing_additional_signers) to 'listing_additional_signers_backup.csv' csv header
--    \copy (select id, sellers_required, additional_signer_signed_at, signing_deadline_at, reminders_sent from public.agreements where sellers_required = 2 or signing_deadline_at is not null) to 'agreements_signers_backup.csv' csv header

-- 1. La política de inserción del dueño vuelve a la de 20261021120000.
drop policy if exists "own agreements insert" on public.agreements;
create policy "own agreements insert" on public.agreements
  for insert to public
  with check (
    auth.uid() = owner_id
    and status in ('pending', 'sent')
    and signed_at is null
    and legal_description_status = 'pending'
    and exists (select 1 from public.properties p
                 where p.id = property_id and p.owner_id = auth.uid())
  );

-- 2. Columnas de agreements.
drop index if exists public.agreements_signing_deadline_idx;
alter table public.agreements drop constraint if exists agreements_additional_signer_check;
alter table public.agreements drop constraint if exists agreements_reminders_sent_check;
alter table public.agreements drop constraint if exists agreements_sellers_required_check;
alter table public.agreements drop column if exists reminders_sent;
alter table public.agreements drop column if exists signing_deadline_at;
alter table public.agreements drop column if exists additional_signer_signed_at;
alter table public.agreements drop column if exists sellers_required;

-- 3. Tablas nuevas (sus triggers y políticas se van con ellas) y el guard.
drop table if exists public.listing_additional_signers;
drop table if exists public.listing_ownership;
drop function if exists public.guard_listing_signers();

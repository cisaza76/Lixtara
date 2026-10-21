-- Reversión de 20261021120000_financing_terms_agreement_legal_status.sql.
-- A. Borra financing_terms y financing_other (se pierde lo que los vendedores eligieron en el
--    paso 3; cash_only sigue intacto) y deja la lista de columnas del vendedor como en 20261017150000.
-- B. Borra agreements.legal_description_status, su trigger y su CHECK, y deja la política
--    "own agreements insert" como en 20260927120000. (La app de este PR deja de poder insertar
--    acuerdos: revertir también el código.)

-- ── B ──
drop policy if exists "own agreements insert" on public.agreements;
create policy "own agreements insert" on public.agreements
  for insert to public
  with check (
    auth.uid() = owner_id
    and status in ('pending', 'sent')
    and signed_at is null
    and exists (select 1 from public.properties p
                 where p.id = property_id and p.owner_id = auth.uid())
  );
drop trigger if exists agreements_require_legal_status on public.agreements;
drop function if exists public.agreements_require_legal_status();
alter table public.agreements drop constraint if exists agreements_legal_description_status_check;
alter table public.agreements drop column if exists legal_description_status;

-- ── A ──

revoke select (financing_terms, financing_other) on public.properties from anon, authenticated;

create or replace function public.properties_seller_writable_columns()
  returns text[]
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select array[
    'address_street', 'address_city', 'address_state', 'address_zip', 'latitude', 'longitude',
    'property_type', 'bedrooms', 'bathrooms', 'sqft', 'lot_size', 'year_built', 'folio',
    'legal_description', 'tax_annual_amount', 'list_price', 'buyer_agent_commission',
    'price_comps', 'price_estimate_low', 'price_estimate_high', 'price_comps_fetched_at',
    'description', 'showing_instructions', 'parking_spaces', 'hoa_fee', 'has_pool',
    'cash_only', 'as_is_sale', 'flood_zone', 'appliances', 'occupancy_status',
    'monthly_rent', 'lease_end_date', 'tenant_cooperation', 'tenant_notes',
    'show_phone_on_portals', 'photos_rights_confirmed',
    'buyer_agent_comp_type', 'buyer_agent_comp_amount', 'buyer_agent_comp_terms_version'
  ]::text[]
$$;

alter table public.properties drop constraint if exists properties_financing_other_check;
alter table public.properties drop constraint if exists properties_financing_terms_check;
alter table public.properties
  drop column if exists financing_other,
  drop column if exists financing_terms;

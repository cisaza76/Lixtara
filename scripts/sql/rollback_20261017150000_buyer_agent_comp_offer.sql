-- Reversión de 20261017150000_buyer_agent_comp_offer. Correr a mano, con OK del owner.
-- Revertir PRIMERO el código: el paso 6 nuevo escribe las columnas que esto borra.
-- Se pierde: el tipo de oferta (0% vs. sin elegir), los montos fijos, la versión del texto y
-- el historial de ofertas. Si hay ofertas en monto fijo, exportarlas antes:
--   select id, buyer_agent_comp_amount from public.properties where buyer_agent_comp_type = 'amount';

drop trigger if exists log_property_buyer_comp_change on public.properties;
drop function if exists public.log_property_buyer_comp_change();
drop table if exists public.property_buyer_comp_history;

-- La lista de columnas del vendedor vuelve a la de 20260927120000.
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
    'show_phone_on_portals', 'photos_rights_confirmed'
  ]::text[]
$$;

alter table public.properties drop constraint if exists properties_buyer_agent_comp_terms_version_check;
alter table public.properties drop constraint if exists properties_buyer_agent_comp_values_check;
alter table public.properties drop constraint if exists properties_buyer_agent_comp_type_check;
alter table public.properties
  drop column if exists buyer_agent_comp_terms_version,
  drop column if exists buyer_agent_comp_amount,
  drop column if exists buyer_agent_comp_type;

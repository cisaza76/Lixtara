-- Rollback de 20261011120000_mls_listings_search_columns.
-- Antes: apagar la exhibición (MLS_DISPLAY_ENABLED) o desplegar un /properties que no
-- filtre por estas columnas; si no, el lector público falla y la página queda sin feed.
drop index if exists public.mls_listings_price_idx;
drop index if exists public.mls_listings_bedrooms_idx;
drop index if exists public.mls_listings_county_idx;
drop index if exists public.mls_listings_postal_idx;
alter table public.mls_listings
  drop column if exists bedrooms,
  drop column if exists bathrooms,
  drop column if exists living_area,
  drop column if exists county_key;
delete from supabase_migrations.schema_migrations where version = '20261011120000';

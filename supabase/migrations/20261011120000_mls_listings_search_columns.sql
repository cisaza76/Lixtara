-- Filtros de búsqueda de /properties sobre el feed IDX: cuartos, baños, área y condado.
--
-- POR QUÉ COLUMNAS GENERADAS: hoy esos campos solo existen dentro de `payload` (jsonb), y
-- filtrar por `payload->>'BedroomsTotal'` obliga a descomprimir el payload de las ~50.000
-- filas en cada búsqueda (medido el 2026-10-10: ~60 s por consulta). Una columna
-- GENERATED ... STORED se calcula al escribir la fila y se indexa. El sync no cambia: sigue
-- escribiendo solo `payload` y Postgres mantiene estas columnas solo.
--
-- Las expresiones son defensivas: un valor que no es número (o un condado vacío) da NULL,
-- nunca un error. Un error aquí haría fallar el upsert de la página entera del sync.
--
-- `county_key` normaliza igual que `normalizeGeoName` (src/lib/mls/coverage.ts) pero sin
-- espacios: "Miami-Dade" / "MIAMI DADE COUNTY" → "miamidade". Los valores aceptados por
-- el filtro viven en src/lib/property-search.ts.
--
-- El ALTER reescribe la tabla una vez (≈ 1 min con 50.000 filas) y la bloquea mientras
-- tanto: aplicarlo fuera del minuto :23 (cron del sync). La exhibición sigue apagada, así
-- que no afecta a la página pública.
--
-- Idempotente. Aplicar SOLO con sign-off del owner.

alter table public.mls_listings
  add column if not exists bedrooms integer generated always as (
    case when jsonb_typeof(payload->'BedroomsTotal') = 'number'
         then floor((payload->>'BedroomsTotal')::numeric)::integer end
  ) stored,
  add column if not exists bathrooms integer generated always as (
    case when jsonb_typeof(payload->'BathroomsTotalInteger') = 'number'
         then floor((payload->>'BathroomsTotalInteger')::numeric)::integer end
  ) stored,
  add column if not exists living_area integer generated always as (
    case when jsonb_typeof(payload->'LivingArea') = 'number'
         then round((payload->>'LivingArea')::numeric)::integer end
  ) stored,
  add column if not exists county_key text generated always as (
    nullif(
      regexp_replace(
        regexp_replace(lower(coalesce(payload->>'CountyOrParish', '')), '[^a-z]', '', 'g'),
        'county$', ''),
      '')
  ) stored;

-- Índices parciales sobre lo que la página pública puede mostrar.
create index if not exists mls_listings_price_idx
  on public.mls_listings (list_price) where withdrawn_at is null;
create index if not exists mls_listings_bedrooms_idx
  on public.mls_listings (bedrooms) where withdrawn_at is null;
create index if not exists mls_listings_county_idx
  on public.mls_listings (county_key) where withdrawn_at is null;
create index if not exists mls_listings_postal_idx
  on public.mls_listings (postal_code) where withdrawn_at is null;

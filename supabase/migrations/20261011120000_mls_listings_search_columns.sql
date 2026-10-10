-- Filtros de búsqueda de /properties sobre el feed IDX: cuartos, baños, área y condado.
--
-- POR QUÉ COLUMNAS PROPIAS: hoy esos campos solo existen dentro de `payload` (jsonb), y
-- filtrar por `payload->>'BedroomsTotal'` obliga a descomprimir el payload de las ~50.000
-- filas en cada búsqueda (medido el 2026-10-10: ~60 s por consulta).
--
-- POR QUÉ TRIGGER Y NO `GENERATED ... STORED`: la primera versión de esta migración usaba
-- columnas generadas, y el ALTER (que reescribe la tabla entera en una sola sentencia)
-- superó el tiempo máximo del SQL Editor de Supabase el 2026-10-11 y se revirtió. Aquí:
--   1. Columnas nulables SIN default → el ALTER es instantáneo, no reescribe nada.
--   2. Un trigger BEFORE INSERT OR UPDATE OF payload las calcula. El sync no cambia: su
--      upsert escribe `payload` y el trigger hace el resto.
--   3. Las filas que ya existían se rellenan en tandas (ver el runbook, § 3.2b), cada una
--      dentro del límite del editor. `search_fields_at` marca qué filas ya están hechas.
--
-- Las expresiones son defensivas: un valor que no es número (o un condado vacío) da NULL,
-- nunca un error. Un error aquí haría fallar el upsert de la página entera del sync.
--
-- `county_key`: minúsculas sin espacios, guiones, puntos ni la palabra "county":
-- "Miami-Dade" / "MIAMI DADE COUNTY" → "miamidade". Los valores aceptados por
-- el filtro viven en src/lib/property-search.ts.
--
-- Idempotente. Aplicar SOLO con sign-off del owner.

alter table public.mls_listings
  add column if not exists bedrooms integer,
  add column if not exists bathrooms integer,
  add column if not exists living_area integer,
  add column if not exists county_key text,
  add column if not exists search_fields_at timestamptz;

-- SIN `$$` ni corchetes a propósito: el owner aplica esto pegándolo en el SQL Editor, y la
-- versión con `$$ ... $$` y una expresión regular con corchetes llegó alterada al copiarla
-- desde el chat (2026-10-11: "syntax error at or near end"). El cuerpo va entre comillas
-- simples (las internas, dobladas) y el condado se normaliza con replace().
create or replace function public.mls_listings_search_fields()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as '
begin
  new.bedrooms := case when jsonb_typeof(new.payload->''BedroomsTotal'') = ''number''
    then floor((new.payload->>''BedroomsTotal'')::numeric)::integer end;
  new.bathrooms := case when jsonb_typeof(new.payload->''BathroomsTotalInteger'') = ''number''
    then floor((new.payload->>''BathroomsTotalInteger'')::numeric)::integer end;
  new.living_area := case when jsonb_typeof(new.payload->''LivingArea'') = ''number''
    then round((new.payload->>''LivingArea'')::numeric)::integer end;
  new.county_key := nullif(replace(replace(replace(replace(
    lower(coalesce(new.payload->>''CountyOrParish'', '''')),
    '' '', ''''), ''-'', ''''), ''.'', ''''), ''county'', ''''), '''');
  new.search_fields_at := now();
  return new;
end;
';

-- Solo la usa el trigger. Supabase concede EXECUTE a anon/authenticated por defecto.
revoke all on function public.mls_listings_search_fields() from public, anon, authenticated;

drop trigger if exists mls_listings_search_fields on public.mls_listings;
create trigger mls_listings_search_fields
  before insert or update of payload on public.mls_listings
  for each row execute function public.mls_listings_search_fields();

-- Índices parciales sobre lo que la página pública puede mostrar. Leen solo las columnas
-- cortas, no el payload: se crean en segundos.
create index if not exists mls_listings_price_idx
  on public.mls_listings (list_price) where withdrawn_at is null;
create index if not exists mls_listings_bedrooms_idx
  on public.mls_listings (bedrooms) where withdrawn_at is null;
create index if not exists mls_listings_county_idx
  on public.mls_listings (county_key) where withdrawn_at is null;
create index if not exists mls_listings_postal_idx
  on public.mls_listings (postal_code) where withdrawn_at is null;
-- Para que cada tanda del relleno encuentre rápido las filas pendientes.
create index if not exists mls_listings_search_pending_idx
  on public.mls_listings (listing_key) where search_fields_at is null;

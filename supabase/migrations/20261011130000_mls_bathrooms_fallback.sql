-- Baños de respaldo para el filtro de /properties.
--
-- Medido el 2026-10-11: 6.523 de 50.836 fichas (12,8 %) traen `BathroomsTotalInteger` en
-- null pero `BathroomsFull` y `BathroomsHalf` como número. Sin respaldo, esas fichas
-- desaparecían de cualquier búsqueda con filtro de baños. RESO define
-- BathroomsTotalInteger como la suma simple de baños, así que el respaldo es
-- completos + medios.
--
-- Solo redefine la función del trigger (20261011120000). Las filas existentes se
-- recalculan aparte, en el runbook § 3.2b, solo las que tienen `bathrooms` en null.
--
-- SIN `$$` ni corchetes: el owner la pega en el SQL Editor (ver 20261011120000).
--
-- Idempotente. Aplicar SOLO con sign-off del owner.

create or replace function public.mls_listings_search_fields()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as '
begin
  new.bedrooms := case when jsonb_typeof(new.payload->''BedroomsTotal'') = ''number''
    then floor((new.payload->>''BedroomsTotal'')::numeric)::integer end;
  new.bathrooms := case
    when jsonb_typeof(new.payload->''BathroomsTotalInteger'') = ''number''
      then floor((new.payload->>''BathroomsTotalInteger'')::numeric)::integer
    when jsonb_typeof(new.payload->''BathroomsFull'') = ''number''
      then floor((new.payload->>''BathroomsFull'')::numeric)::integer
         + case when jsonb_typeof(new.payload->''BathroomsHalf'') = ''number''
                then floor((new.payload->>''BathroomsHalf'')::numeric)::integer else 0 end
  end;
  new.living_area := case when jsonb_typeof(new.payload->''LivingArea'') = ''number''
    then round((new.payload->>''LivingArea'')::numeric)::integer end;
  new.county_key := nullif(replace(replace(replace(replace(
    lower(coalesce(new.payload->>''CountyOrParish'', '''')),
    '' '', ''''), ''-'', ''''), ''.'', ''''), ''county'', ''''), '''');
  new.search_fields_at := now();
  return new;
end;
';

revoke all on function public.mls_listings_search_fields() from public, anon, authenticated;

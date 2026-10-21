-- PR #217 (Listing Agreement ERS-21tn). Dos cambios, aprobados por el owner el 2026-10-21:
--
-- A. Financiación aceptada por el vendedor (paso 3) → línea 23 del contrato: Cash,
--    Conventional, VA, FHA y Other (con texto, obligatorio si Other).
--
-- 1. properties.financing_terms text[]: uno o más de cash, conventional, va, fha, other.
-- 2. properties.financing_other text: el texto de "Other (specify)"; obligatorio con other,
--    prohibido sin other; hasta 120 caracteres (cabe en la línea 23).
-- 3. Relleno: cash_only = true → {cash}. El resto queda null: el paso 3 lo pide de nuevo.
--    cash_only se mantiene (la app lo escribe = financing_terms es exactamente {cash}).
-- 4. properties_seller_writable_columns(): las dos columnas (las escribe el paso 3).
-- 5. SELECT por columna para anon y authenticated (regla desde 20261017150000).
--
-- B. agreements.legal_description_status ('verified' | 'pending'): si la descripción legal del
--    contrato salió verificada con el condado. "Aprobar → Active" del admin lee esta columna
--    (activity_log queda solo como auditoría).
-- 6. Columna + CHECK. Obligatoria para los acuerdos NUEVOS (trigger BEFORE INSERT); los
--    anteriores quedan null y la app los trata como 'pending' (bloqueados).
-- 7. El dueño solo puede insertar 'pending' (política "own agreements insert"): así nadie
--    marca su propio acuerdo como verificado. La app inserta con service_role después de
--    verificar con el condado. Nadie más que service_role actualiza agreements (no hay política
--    de UPDATE para usuarios).
--
-- Idempotente. Reversión: scripts/sql/rollback_20261021120000_financing_terms_agreement_legal_status.sql.
-- Verificación: pnpm db-check:financing-legal-status (PGlite, sin producción).

-- ── A. Financiación ─────────────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists financing_terms text[],
  add column if not exists financing_other text;

update public.properties
   set financing_terms = array['cash']
 where financing_terms is null and cash_only = true;

alter table public.properties drop constraint if exists properties_financing_terms_check;
alter table public.properties add constraint properties_financing_terms_check
  check (
    financing_terms is null
    or (cardinality(financing_terms) between 1 and 5
        and financing_terms <@ array['cash', 'conventional', 'va', 'fha', 'other']::text[])
  );

alter table public.properties drop constraint if exists properties_financing_other_check;
alter table public.properties add constraint properties_financing_other_check
  check (
    (financing_other is null and (financing_terms is null or not ('other' = any(financing_terms))))
    or (financing_other is not null
        and 'other' = any(financing_terms)
        and length(financing_other) <= 120
        and length(btrim(financing_other)) >= 1)
  );

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
    'buyer_agent_comp_type', 'buyer_agent_comp_amount', 'buyer_agent_comp_terms_version',
    'financing_terms', 'financing_other'
  ]::text[]
$$;

grant select (financing_terms, financing_other) on public.properties to anon, authenticated;

-- ── B. Estado de la descripción legal del acuerdo ────────────────────────────────────
alter table public.agreements add column if not exists legal_description_status text;

alter table public.agreements drop constraint if exists agreements_legal_description_status_check;
alter table public.agreements add constraint agreements_legal_description_status_check
  check (legal_description_status is null or legal_description_status in ('verified', 'pending'));

create or replace function public.agreements_require_legal_status()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if new.legal_description_status is null then
    raise exception 'agreements.legal_description_status is required for a new agreement'
      using errcode = '23502';
  end if;
  return new;
end
$$;

drop trigger if exists agreements_require_legal_status on public.agreements;
create trigger agreements_require_legal_status
  before insert on public.agreements
  for each row execute function public.agreements_require_legal_status();

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

-- Oferta de compensación al agente del comprador (paso 6), decisión del owner y la broker
-- 2026-10-17. Tres formas: ninguna (0%), porcentaje o monto fijo en USD. Es aparte de la
-- comisión de Lixtara y no se publica en el MLS (src/config/legal-terms.ts).
--
-- 1. properties: tipo de oferta, monto fijo y versión del texto que vio el vendedor.
--    buyer_agent_commission (%) se conserva para la oferta en porcentaje.
-- 2. Relleno: las filas con 0 < % ≤ 6 (el selector viejo: 2, 2.5 o 3) pasan a 'percent'. Las
--    que tienen 0 quedan sin tipo = el vendedor todavía no eligió.
-- 3. properties_seller_writable_columns(): las tres columnas nuevas (el paso 6 las escribe).
-- 4. property_buyer_comp_history: cada cambio de la oferta con su fecha y versión, escrito
--    solo por un trigger (como property_status_history). Sin FK: sobrevive al listing.
-- 5. La oferta no se lee con la clave pública: anon y authenticated pierden SELECT sobre las
--    cuatro columnas de la oferta (decisión del owner 2026-10-17). El dueño, admin y broker la
--    leen con get_property_buyer_comp(); service_role conserva todo.
--
-- Idempotente. Reversión: scripts/sql/rollback_20261017150000_buyer_agent_comp_offer.sql.
-- Verificación: pnpm db-check:buyer-comp (Postgres desechable en Docker).

-- ── 1. Columnas ─────────────────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists buyer_agent_comp_type text,
  add column if not exists buyer_agent_comp_amount numeric(12,2),
  add column if not exists buyer_agent_comp_terms_version text;

-- ── 2. Relleno (antes de las restricciones) ─────────────────────────────────────────
update public.properties
   set buyer_agent_comp_type = 'percent'
 where buyer_agent_comp_type is null
   and buyer_agent_commission > 0
   and buyer_agent_commission <= 6;

alter table public.properties drop constraint if exists properties_buyer_agent_comp_type_check;
alter table public.properties add constraint properties_buyer_agent_comp_type_check
  check (buyer_agent_comp_type is null or buyer_agent_comp_type in ('none', 'percent', 'amount'));

-- Cada tipo con sus valores y nada más. Sin tipo (filas viejas, borradores sin elegir) no se
-- restringe aquí. coalesce en cada comparación: en un CHECK, NULL > 0 no falla, pasa.
alter table public.properties drop constraint if exists properties_buyer_agent_comp_values_check;
alter table public.properties add constraint properties_buyer_agent_comp_values_check
  check (
    buyer_agent_comp_type is null
    or (buyer_agent_comp_type = 'none'
        and coalesce(buyer_agent_commission, 0) = 0 and buyer_agent_comp_amount is null)
    or (buyer_agent_comp_type = 'percent'
        and coalesce(buyer_agent_commission, 0) > 0 and coalesce(buyer_agent_commission, 0) <= 6
        and buyer_agent_comp_amount is null)
    or (buyer_agent_comp_type = 'amount'
        and coalesce(buyer_agent_comp_amount, 0) > 0 and coalesce(buyer_agent_commission, 0) = 0)
  );

alter table public.properties drop constraint if exists properties_buyer_agent_comp_terms_version_check;
alter table public.properties add constraint properties_buyer_agent_comp_terms_version_check
  check (buyer_agent_comp_terms_version is null or length(buyer_agent_comp_terms_version) between 1 and 64);

-- ── 3. Columnas que el vendedor puede escribir ──────────────────────────────────────
-- Igual que 20260927120000 más las tres columnas nuevas.
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

-- ── 4. Historial de la oferta (solo inserciones, por trigger) ───────────────────────
create table if not exists public.property_buyer_comp_history (
  id             bigint generated always as identity primary key,
  property_id    uuid not null,
  comp_type      text,
  comp_pct       numeric(4,2),
  comp_amount    numeric(12,2),
  terms_version  text,
  -- auth.uid() de quien lo hizo, o el rol ('service_role', 'postgres', …) si no hay usuario.
  changed_by     text not null,
  changed_at     timestamptz not null default now()
);
create index if not exists property_buyer_comp_history_property_idx
  on public.property_buyer_comp_history (property_id, changed_at desc);

alter table public.property_buyer_comp_history enable row level security;
drop policy if exists "Brokers can view buyer comp history" on public.property_buyer_comp_history;
create policy "Brokers can view buyer comp history" on public.property_buyer_comp_history
  for select to authenticated using (public.is_admin_or_broker());
drop policy if exists "Owners can view their buyer comp history" on public.property_buyer_comp_history;
create policy "Owners can view their buyer comp history" on public.property_buyer_comp_history
  for select to authenticated using (
    exists (select 1 from public.properties p
             where p.id = property_buyer_comp_history.property_id and p.owner_id = auth.uid()));
-- Nadie de la API escribe, edita ni borra: solo el trigger (definer) inserta.
revoke all on public.property_buyer_comp_history from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.property_buyer_comp_history from authenticated;
grant select on public.property_buyer_comp_history to authenticated;
grant select, insert, update, delete on public.property_buyer_comp_history to service_role;

create or replace function public.log_property_buyer_comp_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_role text := current_setting('role', true);
begin
  if new.buyer_agent_comp_type is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.buyer_agent_comp_type is not distinct from old.buyer_agent_comp_type
     and new.buyer_agent_commission is not distinct from old.buyer_agent_commission
     and new.buyer_agent_comp_amount is not distinct from old.buyer_agent_comp_amount
     and new.buyer_agent_comp_terms_version is not distinct from old.buyer_agent_comp_terms_version then
    return null;
  end if;

  insert into public.property_buyer_comp_history (
    property_id, comp_type, comp_pct, comp_amount, terms_version, changed_by)
  values (
    new.id, new.buyer_agent_comp_type,
    case when new.buyer_agent_comp_type = 'percent' then new.buyer_agent_commission end,
    new.buyer_agent_comp_amount, new.buyer_agent_comp_terms_version,
    case
      when v_role in ('authenticated', 'anon') then coalesce(auth.uid()::text, v_role)
      when v_role is null or v_role = 'none' then session_user::text
      else v_role
    end);
  return null;
end;
$$;

revoke execute on function public.log_property_buyer_comp_change() from public, anon, authenticated;

drop trigger if exists log_property_buyer_comp_change on public.properties;
create trigger log_property_buyer_comp_change
  after insert or update on public.properties
  for each row execute function public.log_property_buyer_comp_change();

-- ── 5. Lectura de la oferta: solo el dueño, admin y broker ──────────────────────────
-- Un privilegio de columna no distingue filas (el dueño, admin y broker también son
-- `authenticated`), así que: (a) anon y authenticated leen todas las columnas MENOS las de la
-- oferta, y (b) get_property_buyer_comp() (definer) se la devuelve solo a quien corresponde.
-- Un REVOKE de tabla no quita la columna si queda el SELECT de tabla: hay que quitar el de
-- tabla y dar el de cada columna. Revocar el de tabla también borra los de columna, así que
-- re-correr esto es idempotente.
--
-- OJO, columnas nuevas de properties: después de esta migración NO son legibles por la API
-- hasta que su migración haga `grant select (<columna>) on public.properties to anon,
-- authenticated` (src/lib/properties-column-grants.test.ts falla si falta).
revoke select on public.properties from anon, authenticated;
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'properties'
     and column_name not in ('buyer_agent_commission', 'buyer_agent_comp_type',
                             'buyer_agent_comp_amount', 'buyer_agent_comp_terms_version');
  execute format('grant select (%s) on public.properties to anon, authenticated', v_cols);
end;
$$;
grant select on public.properties to service_role;

create or replace function public.get_property_buyer_comp(p_property_id uuid)
  returns table (
    buyer_agent_comp_type          text,
    buyer_agent_commission         numeric,
    buyer_agent_comp_amount        numeric,
    buyer_agent_comp_terms_version text
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select p.buyer_agent_comp_type, p.buyer_agent_commission, p.buyer_agent_comp_amount,
         p.buyer_agent_comp_terms_version
    from public.properties p
   where p.id = p_property_id
     and (p.owner_id = auth.uid() or public.is_admin_or_broker())
$$;

revoke execute on function public.get_property_buyer_comp(uuid) from public, anon;
grant execute on function public.get_property_buyer_comp(uuid) to authenticated, service_role;


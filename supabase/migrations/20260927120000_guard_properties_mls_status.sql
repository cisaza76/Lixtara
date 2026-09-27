-- Un vendedor solo puede escribir los datos de SU listing; nunca su estado, su pago, su
-- aprobación ni su marca de prueba. Más historial de cambios de estado y datos de prueba.
--
-- EL HUECO
-- La política RLS "Users can update own properties" (USING auth.uid() = owner_id) restringe
-- FILAS, no columnas. Con la publishable key y su sesión, un vendedor podía hacer
--   update properties set mls_status = 'active' where id = <su listing>
-- y saltarse al broker, el pago y el acuerdo firmado; o cambiar su pricing_tier después de
-- pagar (pagar Essentials, quedarse Concierge). Y las políticas de INSERT de `payments` y
-- `agreements` no restringían columnas: podía crear su propio pago "succeeded" o su propio
-- acuerdo "signed".
--
-- QUIÉN ESCRIBE QUÉ (mapeado en el código el 2026-09-27)
--   properties  INSERT draft + datos del listing ← asistente /listing/new (sesión vendedor)
--               draft → pending_approval + tier  ← webhook de Stripe (service_role)
--               active / withdrawn / draft       ← aprobar / rechazar / pedir cambios (admin/broker)
--               mls_number                       ← admin/broker (PR #132)
--   payments    INSERT status 'pending'          ← /api/checkout/* (sesión vendedor)
--               → succeeded / failed             ← webhook de Stripe (service_role)
--   agreements  INSERT status 'sent'             ← /api/agreement/create (sesión vendedor)
--               → signed / completed / …         ← webhook y sync de DocuSign (service_role)
--
-- LO QUE HACE
--   1. properties.is_test — marca de datos de prueba; la lectura pública los excluye.
--   2. guard_properties_seller_columns (BEFORE): para roles de la API que no son
--      admin/broker, LISTA DE COLUMNAS PERMITIDAS. Cualquier otra columna que cambie se
--      rechaza. pricing_tier solo mientras el listing está en draft. is_test solo lo
--      cambia un admin (no un broker) o service_role.
--   3. property_status_history + log_property_status_change (AFTER): cada cambio de
--      mls_status / mls_published_at / mls_expires_at queda registrado, venga de donde
--      venga (aprobación rápida de /admin incluida). Solo inserciones.
--   4. payments / agreements: el INSERT de la sesión solo admite el estado inicial.
--   5. Marca is_test = true en los 9 listings de prueba conocidos (6 [DEMO] + 3).
--
-- SECURITY DEFINER con search_path fijo en ambas funciones de trigger:
--   - El historial debe escribirse aunque quien dispara sea `authenticated`, que no tiene
--     permiso de INSERT sobre él — ese es justamente el punto de la tabla.
--   - Por eso el rol de la PETICIÓN no se lee de current_user (que dentro de un definer
--     es el dueño de la función) sino de current_setting('role'), que es lo que fija
--     PostgREST con `SET ROLE authenticated` y que un definer no altera. Verificado contra
--     Postgres real: scripts/db-checks/ (pnpm db-check:mls-status-guard).
--   - Una función `returns trigger` no se puede invocar por RPC: el definer no expone
--     nada nuevo por la API.
--
-- Idempotente. Aplicar SOLO con sign-off del owner (`supabase db push`), DESPUÉS de las
-- migraciones de #132. Rollback: docs/superpowers/runbooks/rollback-20260927120000_guard_properties_mls_status.sql

begin;

-- ── 1. Datos de prueba ────────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists is_test boolean not null default false;

comment on column public.properties.is_test is
  'Registro de prueba. Excluido de toda lectura pública sin importar su estado. Las pruebas '
  'van en preview; si hace falta probar en producción, el registro se crea con is_test = true. '
  'Solo admin o service_role pueden cambiarlo.';

drop policy if exists "Public can view active listings" on public.properties;
create policy "Public can view active listings" on public.properties
  for select to public using (mls_status = 'active' and not is_test);

drop policy if exists "properties_public_read_active" on public.properties;
create policy "properties_public_read_active" on public.properties
  for select to anon, authenticated using (mls_status = 'active' and not is_test);

-- ── 2. Columnas que el vendedor puede escribir ───────────────────────────────────
-- Exactamente las que escribe el asistente /listing/new. Todo lo demás —id, owner_id,
-- mls_number, mls_status, mls_published_at, mls_expires_at, created_at, is_test y
-- cualquier columna futura— queda bloqueado por defecto. pricing_tier se trata aparte.
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

create or replace function public.guard_properties_seller_columns()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_role     text := current_setting('role', true);
  v_api      boolean := v_role in ('authenticated', 'anon');
  v_staff    boolean;
  v_admin    boolean;
  v_bloqueadas text[];
begin
  if not v_api then
    return new;                       -- service_role, migraciones, operación manual
  end if;
  v_staff := public.is_admin_or_broker();
  v_admin := public.has_role('admin');

  -- is_test: solo admin (un broker tampoco).
  if not v_admin and (
       (tg_op = 'INSERT' and new.is_test)
    or (tg_op = 'UPDATE' and new.is_test is distinct from old.is_test)) then
    raise exception 'Only an admin can change properties.is_test.' using errcode = '42501';
  end if;

  if v_staff then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.mls_status is distinct from 'draft'
       or new.mls_number is not null
       or new.mls_published_at is not null
       or new.mls_expires_at is not null then
      raise exception 'A new listing must start as a draft with no MLS or publication data.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: columnas que cambian y no están permitidas. updated_at lo mantiene otro trigger.
  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_bloqueadas
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value
     and n.key <> 'updated_at'
     and n.key <> all (public.properties_seller_writable_columns())
     and not (n.key = 'pricing_tier' and old.mls_status = 'draft');

  if cardinality(v_bloqueadas) > 0 then
    raise exception 'Only a broker or admin can change: %', array_to_string(v_bloqueadas, ', ')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- El guard de #133 v1 (mismo archivo, nunca aplicado) se llamaba guard_properties_mls_status.
drop trigger if exists guard_properties_mls_status on public.properties;
drop function if exists public.guard_properties_mls_status();

drop trigger if exists guard_properties_seller_columns on public.properties;
create trigger guard_properties_seller_columns
  before insert or update on public.properties
  for each row execute function public.guard_properties_seller_columns();

-- ── 3. Historial de estado (solo inserciones) ────────────────────────────────────
create table if not exists public.property_status_history (
  id                bigint generated always as identity primary key,
  -- Sin FK: el historial debe sobrevivir al listing.
  property_id       uuid not null,
  old_status        text,
  new_status        text,
  old_published_at  timestamptz,
  new_published_at  timestamptz,
  old_expires_at    timestamptz,
  new_expires_at    timestamptz,
  -- auth.uid() de quien lo hizo, o el rol ('service_role', 'postgres', …) si no hay usuario.
  changed_by        text not null,
  changed_at        timestamptz not null default now()
);
create index if not exists property_status_history_property_idx
  on public.property_status_history (property_id, changed_at desc);

alter table public.property_status_history enable row level security;
drop policy if exists "Brokers can view status history" on public.property_status_history;
create policy "Brokers can view status history" on public.property_status_history
  for select to authenticated using (public.is_admin_or_broker());
-- Nadie de la API escribe, edita ni borra: solo el trigger (definer) inserta. Supabase da
-- ALL a anon/authenticated/service_role en cada tabla nueva de public por defecto; aquí se
-- retira a los dos primeros y se deja explícito lo del service_role (única vía de corrección).
revoke insert, update, delete, truncate on public.property_status_history from public, anon, authenticated;
grant select, insert, update, delete on public.property_status_history to service_role;

create or replace function public.log_property_status_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_role text := current_setting('role', true);
begin
  if tg_op = 'UPDATE'
     and new.mls_status is not distinct from old.mls_status
     and new.mls_published_at is not distinct from old.mls_published_at
     and new.mls_expires_at is not distinct from old.mls_expires_at then
    return null;
  end if;

  insert into public.property_status_history (
    property_id, old_status, new_status, old_published_at, new_published_at,
    old_expires_at, new_expires_at, changed_by)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.mls_status end, new.mls_status,
    case when tg_op = 'UPDATE' then old.mls_published_at end, new.mls_published_at,
    case when tg_op = 'UPDATE' then old.mls_expires_at end, new.mls_expires_at,
    case
      when v_role in ('authenticated', 'anon') then coalesce(auth.uid()::text, v_role)
      when v_role is null or v_role = 'none' then session_user::text
      else v_role
    end);
  return null;
end;
$$;

drop trigger if exists log_property_status_change on public.properties;
create trigger log_property_status_change
  after insert or update of mls_status, mls_published_at, mls_expires_at on public.properties
  for each row execute function public.log_property_status_change();

-- ── 4. payments / agreements: la sesión solo crea el estado inicial ───────────────
drop policy if exists "own payments insert" on public.payments;
create policy "own payments insert" on public.payments
  for insert to public
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and completed_at is null
    and stripe_payment_intent_id is null
    and stripe_charge_id is null
    and receipt_url is null
    and exists (select 1 from public.properties p
                 where p.id = property_id and p.owner_id = auth.uid())
  );

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

-- ── 5. Los 9 listings de prueba conocidos (retirados del sitio el 2026-09-27) ────
-- IDs de producción; en cualquier otra base no existen y esto no hace nada.
update public.properties set is_test = true
 where id in (
   'b09d0501-20a7-4eb5-a298-404d5f53587d', 'b4ccd397-7117-4fce-be80-51d9b89bda8e',
   'b48b6bd9-fbe6-4ef8-b169-25aa17408665', 'a9c98643-01af-4ac0-bea6-c2ac2a3fd7f7',
   'dc57f155-51d1-48f8-8f1d-71b28a5abfd7', '61e682ff-a035-4634-9d92-755a1f16cad8',
   'f5011777-fb80-4e79-ac6d-78891bdec47e', 'abadb9e7-17bd-48cb-80c7-6a9cf6b60a3f',
   '2da3ae77-7dd1-4e95-88a8-3e0a1ff97c3f')
   and not is_test;

commit;

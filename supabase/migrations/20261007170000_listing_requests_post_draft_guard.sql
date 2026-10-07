-- Cambios y retiros de un listing ya enviado pasan por la broker (#134, #136).
--
-- EL HUECO (después de #133)
-- guard_properties_seller_columns deja al vendedor escribir toda la lista de columnas
-- permitidas en CUALQUIER estado. En un listing activo eso es precio, dirección,
-- características, descripción… publicados al instante en lixtara.com sin pasar por Matrix:
-- el sitio y el MLS divergen, y la broker responde por lo publicado bajo su licencia.
-- Y el vendedor no tenía forma de pedir el retiro de su listing (el estado es solo de staff).
--
-- LO QUE HACE
--   1. properties_seller_post_draft_columns(): lo único que el vendedor escribe directo
--      cuando el listing YA NO es borrador. Ninguna columna publicada ni enviada al MLS.
--   2. guard_properties_seller_columns: borrador → lista completa (igual que #133);
--      cualquier otro estado → solo la lista corta. Lo demás va por solicitud.
--   3. listing_requests: solicitudes del vendedor (cambio de campos o retiro). Las crea el
--      servidor (service_role) tras verificar sesión y dueño; la broker las aprueba o
--      rechaza desde /admin. El vendedor solo las LEE (ve su estado en el dashboard).
--   4. broker_tasks: task_type `review_listing_change` y `withdraw_listing`.
--
-- Idempotente. Aplicar SOLO con sign-off del owner (`supabase db push`), DESPUÉS de
-- 20260927120000. Verificación contra Postgres real: pnpm db-check:listing-requests.
-- Rollback: docs/superpowers/runbooks/rollback-20261007170000_listing_requests_post_draft_guard.sql

begin;

-- ── 1. Lo que el vendedor escribe después del borrador ────────────────────────────
-- No se publica ni se envía al MLS:
--   show_phone_on_portals     preferencia de contacto del propio vendedor
--   photos_rights_confirmed   su declaración de derechos sobre las fotos (paso 5)
--   price_comps*, price_estimate_*  comparables internos (Rentcast), no publicados
create or replace function public.properties_seller_post_draft_columns()
  returns text[]
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select array[
    'show_phone_on_portals', 'photos_rights_confirmed',
    'price_comps', 'price_estimate_low', 'price_estimate_high', 'price_comps_fetched_at'
  ]::text[]
$$;

-- ── 2. Guard: la lista depende del estado ANTERIOR del listing ─────────────────────
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
  v_draft    boolean;
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

  -- UPDATE. Borrador (o sin estado, que el default trata como borrador): lista completa.
  -- Enviado, activo, bajo contrato, cerrado…: solo la lista corta (#136).
  v_draft := coalesce(old.mls_status, 'draft') = 'draft';

  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_bloqueadas
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value
     and n.key <> 'updated_at'
     and n.key <> all (case when v_draft
                            then public.properties_seller_writable_columns()
                            else public.properties_seller_post_draft_columns() end)
     and not (n.key = 'pricing_tier' and v_draft);

  if cardinality(v_bloqueadas) > 0 then
    if v_draft then
      raise exception 'Only a broker or admin can change: %', array_to_string(v_bloqueadas, ', ')
        using errcode = '42501';
    end if;
    raise exception 'This listing is no longer a draft; request the change from the broker: %',
      array_to_string(v_bloqueadas, ', ')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── 3. Solicitudes del vendedor ─────────────────────────────────────────────────
create table if not exists public.listing_requests (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties (id) on delete cascade,
  kind           text not null check (kind in ('change', 'withdrawal')),
  -- kind = 'change': {"list_price": {"old": 500000, "new": 480000}, …}. 'withdrawal': {}.
  changes        jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  reason         text check (reason is null or char_length(reason) <= 2000),
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by   uuid not null,
  broker_task_id uuid,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  review_note    text check (review_note is null or char_length(review_note) <= 2000),
  created_at     timestamptz not null default now(),
  constraint listing_requests_change_has_fields
    check (kind <> 'change' or changes <> '{}'::jsonb)
);

-- Una sola solicitud pendiente por listing y tipo: deduplica dobles clics y reintentos.
create unique index if not exists listing_requests_one_pending_idx
  on public.listing_requests (property_id, kind) where status = 'pending';
create index if not exists listing_requests_property_idx
  on public.listing_requests (property_id, created_at desc);

alter table public.listing_requests enable row level security;

drop policy if exists "Owners can view own listing requests" on public.listing_requests;
create policy "Owners can view own listing requests" on public.listing_requests
  for select to authenticated
  using (exists (select 1 from public.properties p
                  where p.id = property_id and p.owner_id = auth.uid()));

drop policy if exists "Brokers can manage listing requests" on public.listing_requests;
create policy "Brokers can manage listing requests" on public.listing_requests
  for all to authenticated
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

-- El vendedor nunca escribe aquí: el endpoint crea la fila con service_role tras validar
-- sesión, dueño, estado y campos. Supabase da ALL a anon/authenticated por defecto.
revoke all on public.listing_requests from public, anon;
revoke insert, delete, truncate on public.listing_requests from authenticated;
grant select, update on public.listing_requests to authenticated;
grant all on public.listing_requests to service_role;

comment on table public.listing_requests is
  'Solicitudes del vendedor sobre un listing ya enviado: cambio de campos o retiro. Las '
  'crea el servidor (service_role); la broker las aprueba/rechaza y, solo entonces, se '
  'aplican a properties. #134, #136.';

-- ── 4. Tipos de tarea para la broker ─────────────────────────────────────────────
alter table public.broker_tasks drop constraint if exists broker_tasks_task_type_check;
alter table public.broker_tasks add constraint broker_tasks_task_type_check
  check (task_type = any (array[
    'approve_listing', 'review_offer', 'coordinate_closing', 'resolve_issue', 'follow_up',
    'enter_mls_number', 'review_listing_change', 'withdraw_listing'
  ]::text[]));

commit;

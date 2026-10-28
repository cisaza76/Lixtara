-- =============================================================================
-- listing_signers: titular del listing y segundo firmante vendedor (#220).
--
-- Hoy el sitio maneja un solo vendedor por listing. Con dos dueños en el título, o con el
-- cónyuge de un dueño casado cuando es homestead, el acuerdo necesita la firma de los dos.
-- Esta migración solo crea dónde guardarlo. El código (paso 3, plantilla "Seller 2", webhook,
-- cron de 7 días, admin) va en PRs aparte.
--
-- A. public.listing_ownership: quién es el titular (paso 3). Una fila por listing.
--    owner_kind:
--      'individuals'   — una o dos personas físicas (autoservicio, hasta 2 firmantes);
--      'fl_entity'     — LLC o corporación de Florida, un firmante con autoridad declarada;
--      'manual_review' — entidad no registrada en Florida, trust, sucesión, 3+ dueños o firma
--                        con poder (POA): sin checkout automático hasta que el staff lo destrabe.
--    Columnas de STAFF (solo admin/broker o el servidor): sunbiz_status / _checked_by /
--    _checked_at, authority_document_received_at / _by, manual_review_cleared_at / _by.
-- B. public.listing_additional_signers: el segundo firmante (v1: uno por listing). Nombre y
--    email de un TERCERO: tabla aparte de properties, que tiene SELECT por columna para anon.
-- C. public.agreements: sellers_required, additional_signer_signed_at, signing_deadline_at,
--    reminders_sent. La política de inserción del dueño exige que sellers_required coincida
--    con los firmantes guardados, y que el resto empiece vacío.
--
-- Acceso (las dos tablas nuevas):
--   * anon: nada.
--   * Dueño del listing: lee siempre; inserta, cambia y borra SOLO mientras el listing es
--     borrador (properties.mls_status = 'draft') y solo sus columnas.
--   * Admin/broker: leen todo; cambian SOLO las columnas de staff (trigger).
--   * service_role: todo (webhook de DocuSign, cron, correcciones).
-- Validaciones en la base (además de las del código):
--   * listing_ownership.owner_id y listing_additional_signers.owner_id = dueño del listing;
--   * el email del segundo firmante no puede ser el del vendedor (trigger, lee auth.users);
--   * coherencia de cada owner_kind con sus columnas (checks).
--
-- Depende de 20261021120000 (política "own agreements insert" con legal_description_status):
-- aplicar después de esa.
-- Idempotente. Reversión: scripts/sql/rollback_20261028120000_listing_signers.sql.
-- Verificación sin producción: pnpm db-check:listing-signers (PGlite).
-- NO APLICADA: aplicar SOLO con sign-off explícito del owner (`supabase db push`).
-- =============================================================================

-- ── A. Titular del listing ──────────────────────────────────────────────────────────
create table if not exists public.listing_ownership (
  property_id uuid primary key references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_kind text not null check (owner_kind in ('individuals', 'fl_entity', 'manual_review')),
  -- Paso 3: "¿Hay otra persona en el título?" y "¿Es el homestead de un dueño casado?".
  other_title_holders boolean not null,
  married_homestead boolean not null,
  -- fl_entity
  entity_name text check (entity_name is null or char_length(btrim(entity_name)) between 2 and 200),
  entity_signer_title text check (entity_signer_title is null or char_length(btrim(entity_signer_title)) between 2 and 80),
  entity_authority_confirmed_at timestamptz,
  -- Staff: Sunbiz manual en la v1 (la broker busca en sunbiz.org y lo marca).
  sunbiz_status text not null default 'unchecked' check (sunbiz_status in ('unchecked', 'listed', 'not_listed')),
  sunbiz_checked_by uuid references auth.users(id) on delete set null,
  sunbiz_checked_at timestamptz,
  -- Staff: resolución o poder recibido (sin esto no hay contrafirma si sunbiz_status = 'not_listed').
  authority_document_received_at timestamptz,
  authority_document_received_by uuid references auth.users(id) on delete set null,
  -- manual_review
  manual_review_reason text check (manual_review_reason in ('non_fl_entity', 'trust', 'estate', 'three_or_more_owners', 'poa')),
  -- Staff: la broker destraba el caso a mano.
  manual_review_cleared_at timestamptz,
  manual_review_cleared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_ownership_entity_fields check (
    (owner_kind = 'fl_entity') = (entity_name is not null)
    and (owner_kind = 'fl_entity') = (entity_signer_title is not null)
    and (owner_kind = 'fl_entity') = (entity_authority_confirmed_at is not null)
  ),
  constraint listing_ownership_manual_review_reason check (
    (owner_kind = 'manual_review') = (manual_review_reason is not null)
  ),
  -- Sunbiz y el documento de autoridad son solo de una entidad.
  constraint listing_ownership_sunbiz_entity_only check (
    owner_kind = 'fl_entity'
    or (sunbiz_status = 'unchecked' and authority_document_received_at is null)
  ),
  -- Quién y cuándo, siempre juntos con la marca.
  constraint listing_ownership_sunbiz_checked check (
    (sunbiz_status = 'unchecked') = (sunbiz_checked_at is null)
  ),
  constraint listing_ownership_manual_review_cleared check (
    owner_kind = 'manual_review' or manual_review_cleared_at is null
  )
);

comment on table public.listing_ownership is
  'Titular del listing (#220): personas físicas, entidad de Florida o revisión manual. Columnas sunbiz_*, authority_document_* y manual_review_cleared_* solo las cambia el staff.';

create index if not exists listing_ownership_owner_idx on public.listing_ownership (owner_id);

-- ── B. Segundo firmante vendedor ─────────────────────────────────────────────────────
create table if not exists public.listing_additional_signers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null check (relationship in ('title_holder', 'homestead_spouse')),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Casilla: el vendedor confirma que tiene permiso para dar estos datos.
  permission_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.listing_additional_signers is
  'Segundo firmante vendedor del acuerdo (#220): copropietario en el título o cónyuge por homestead. Datos de un tercero: sin lectura pública.';

create index if not exists listing_additional_signers_owner_idx on public.listing_additional_signers (owner_id);

-- ── Guard común de las dos tablas ─────────────────────────────────────────────────────
-- API (anon/authenticated): el dueño escribe sus columnas mientras el listing es borrador;
-- el staff cambia solo las columnas de staff. service_role y migraciones: sin restricción.
create or replace function public.guard_listing_signers()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_role   text := current_setting('role', true);
  v_api    boolean := v_role in ('authenticated', 'anon');
  v_row    jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_prop   uuid := (v_row ->> 'property_id')::uuid;
  v_owner  uuid;
  v_status text;
  v_staff_cols text[] := array[
    'sunbiz_status', 'sunbiz_checked_by', 'sunbiz_checked_at',
    'authority_document_received_at', 'authority_document_received_by',
    'manual_review_cleared_at', 'manual_review_cleared_by'];
  v_changed text[];
begin
  select p.owner_id, p.mls_status into v_owner, v_status
    from public.properties p where p.id = v_prop;

  -- owner_id es siempre el dueño del listing (también para service_role).
  if tg_op <> 'DELETE' and ((v_row ->> 'owner_id')::uuid is distinct from v_owner) then
    raise exception 'owner_id must be the listing owner' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and ((to_jsonb(old) ->> 'property_id')::uuid is distinct from v_prop) then
    raise exception 'property_id cannot change' using errcode = '42501';
  end if;

  -- El segundo firmante no puede ser el mismo vendedor.
  -- (por jsonb: listing_ownership no tiene columna email)
  if tg_table_name = 'listing_additional_signers' and tg_op <> 'DELETE'
     and exists (select 1 from auth.users u
                  where u.id = (v_row ->> 'owner_id')::uuid
                    and lower(btrim(u.email)) = lower(btrim(v_row ->> 'email'))) then
    raise exception 'The additional signer email must differ from the seller''s email'
      using errcode = '23514';
  end if;

  if not v_api then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Columnas que cambian (sin contar updated_at).
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
  end if;

  if public.is_admin_or_broker() and auth.uid() is distinct from v_owner then
    -- Staff: solo sus columnas, y solo en listing_ownership.
    if tg_table_name <> 'listing_ownership' or tg_op <> 'UPDATE'
       or not (v_changed <@ v_staff_cols) then
      raise exception 'Staff can only change the Sunbiz, authority-document and manual-review marks'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Dueño: solo mientras el listing es borrador.
  if auth.uid() is distinct from v_owner then
    raise exception 'Only the listing owner can change its signers' using errcode = '42501';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Signers can only change while the listing is a draft' using errcode = '42501';
  end if;
  if tg_table_name = 'listing_ownership' then
    if tg_op = 'INSERT' and (
         new.sunbiz_status <> 'unchecked' or new.sunbiz_checked_by is not null or new.sunbiz_checked_at is not null
      or new.authority_document_received_at is not null or new.authority_document_received_by is not null
      or new.manual_review_cleared_at is not null or new.manual_review_cleared_by is not null) then
      raise exception 'Only a broker or admin can set the Sunbiz, authority-document and manual-review marks'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and v_changed && v_staff_cols then
      raise exception 'Only a broker or admin can change: %', array_to_string(
        array(select unnest(v_changed) intersect select unnest(v_staff_cols)), ', ')
        using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.guard_listing_signers() from public, anon, authenticated;

drop trigger if exists guard_listing_ownership on public.listing_ownership;
create trigger guard_listing_ownership
  before insert or update or delete on public.listing_ownership
  for each row execute function public.guard_listing_signers();

drop trigger if exists guard_listing_additional_signers on public.listing_additional_signers;
create trigger guard_listing_additional_signers
  before insert or update or delete on public.listing_additional_signers
  for each row execute function public.guard_listing_signers();

drop trigger if exists listing_ownership_updated_at on public.listing_ownership;
create trigger listing_ownership_updated_at
  before update on public.listing_ownership
  for each row execute function public.update_updated_at_column();

drop trigger if exists listing_additional_signers_updated_at on public.listing_additional_signers;
create trigger listing_additional_signers_updated_at
  before update on public.listing_additional_signers
  for each row execute function public.update_updated_at_column();

-- ── RLS ───────────────────────────────────────────────────────────────────────────
alter table public.listing_ownership enable row level security;
alter table public.listing_additional_signers enable row level security;

drop policy if exists "listing_ownership own read" on public.listing_ownership;
create policy "listing_ownership own read" on public.listing_ownership
  for select to authenticated using (owner_id = auth.uid());
drop policy if exists "listing_ownership staff read" on public.listing_ownership;
create policy "listing_ownership staff read" on public.listing_ownership
  for select to authenticated using (public.is_admin_or_broker());
drop policy if exists "listing_ownership own insert" on public.listing_ownership;
create policy "listing_ownership own insert" on public.listing_ownership
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "listing_ownership own update" on public.listing_ownership;
create policy "listing_ownership own update" on public.listing_ownership
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- El staff marca Sunbiz / documento / revisión manual (el trigger limita las columnas).
drop policy if exists "listing_ownership staff update" on public.listing_ownership;
create policy "listing_ownership staff update" on public.listing_ownership
  for update to authenticated using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

drop policy if exists "listing_additional_signers own read" on public.listing_additional_signers;
create policy "listing_additional_signers own read" on public.listing_additional_signers
  for select to authenticated using (owner_id = auth.uid());
drop policy if exists "listing_additional_signers staff read" on public.listing_additional_signers;
create policy "listing_additional_signers staff read" on public.listing_additional_signers
  for select to authenticated using (public.is_admin_or_broker());
drop policy if exists "listing_additional_signers own insert" on public.listing_additional_signers;
create policy "listing_additional_signers own insert" on public.listing_additional_signers
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "listing_additional_signers own update" on public.listing_additional_signers;
create policy "listing_additional_signers own update" on public.listing_additional_signers
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "listing_additional_signers own delete" on public.listing_additional_signers;
create policy "listing_additional_signers own delete" on public.listing_additional_signers
  for delete to authenticated using (owner_id = auth.uid());

-- Supabase da ALL a anon/authenticated en tablas nuevas de public: se deja solo lo necesario.
revoke all on public.listing_ownership from public, anon, authenticated;
revoke all on public.listing_additional_signers from public, anon, authenticated;
grant select, insert, update on public.listing_ownership to authenticated;
grant select, insert, update, delete on public.listing_additional_signers to authenticated;
grant all on public.listing_ownership to service_role;
grant all on public.listing_additional_signers to service_role;

-- ── C. agreements: firma de todos los vendedores y plazo de 7 días ──────────────────
alter table public.agreements add column if not exists sellers_required smallint not null default 1;
alter table public.agreements add column if not exists additional_signer_signed_at timestamptz;
alter table public.agreements add column if not exists signing_deadline_at timestamptz;
alter table public.agreements add column if not exists reminders_sent smallint not null default 0;

alter table public.agreements drop constraint if exists agreements_sellers_required_check;
alter table public.agreements add constraint agreements_sellers_required_check
  check (sellers_required between 1 and 2);
alter table public.agreements drop constraint if exists agreements_reminders_sent_check;
alter table public.agreements add constraint agreements_reminders_sent_check
  check (reminders_sent between 0 and 2);
-- Con un solo vendedor no hay segunda firma.
alter table public.agreements drop constraint if exists agreements_additional_signer_check;
alter table public.agreements add constraint agreements_additional_signer_check
  check (sellers_required = 2 or additional_signer_signed_at is null);

-- El cron de plazos y recordatorios busca acuerdos pendientes de la segunda firma.
create index if not exists agreements_signing_deadline_idx on public.agreements (signing_deadline_at)
  where sellers_required = 2 and additional_signer_signed_at is null and signing_deadline_at is not null;

-- El dueño crea el acuerdo con su sesión (/api/agreement/create). Además de lo de
-- 20261021120000: sellers_required = 1 + firmantes guardados, sin segunda firma ni
-- recordatorios, y un plazo de como mucho 7 días (más un margen de 1 h).
-- Los cambios posteriores (firmas, recordatorios) solo los hace service_role.
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
    and sellers_required = 1 + (select count(*) from public.listing_additional_signers s
                                 where s.property_id = agreements.property_id)
    and additional_signer_signed_at is null
    and reminders_sent = 0
    and (signing_deadline_at is null or signing_deadline_at <= now() + interval '7 days 1 hour')
  );

-- Fecha de publicación en el MLS (`properties.mls_published_at`) como prueba de devengo de la
-- tarifa fija. La política de reembolso (src/config/legal-terms.ts#refundPolicy) devuelve el
-- total si el vendedor cancela ANTES de la publicación; esta fecha es la que lo decide:
-- null = no publicado = reembolso total.
--
-- LA COLUMNA YA EXISTE (baseline 20260520151434) y ya es legible con la clave pública: la
-- migración 20261017150000 dio SELECT por columna sobre todas las columnas de properties salvo
-- las cuatro de la oferta al agente del comprador. Nadie la escribía: el vendedor la tiene
-- bloqueada (guard_properties_seller_columns) y el admin no tenía botón. Esta migración NO
-- agrega columnas a properties, así que no hace falta un grant nuevo.
--
-- LO QUE HACE
--   1. property_status_history.note — nota de la corrección (solo inserciones, como el resto).
--   2. log_property_status_change: guarda la nota de la transacción (lixtara.status_note).
--   3. guard_properties_mls_published_at (BEFORE, todos los roles de la API y service_role):
--        - Marcar (null → fecha): solo admin o broker con su sesión; exige mls_number, un
--          acuerdo `completed` (contrafirmado) y el pago del plan `succeeded`; nunca en el
--          futuro. Un INSERT no puede traer la fecha.
--        - Una vez fijada no se edita ni se borra: solo un admin la corrige, con nota
--          (≥ 10 caracteres), por correct_property_mls_published_at().
--        - service_role tampoco la escribe: la fija una persona, no un proceso.
--      Sin rol de la API (postgres en el SQL Editor, migraciones) pasa, y queda en el historial.
--   4. correct_property_mls_published_at(id, fecha, nota): la única vía de corrección. Invoker
--      (RLS y el guard aplican); fija la nota en la transacción y hace el update.
--
-- Quién y cuándo: property_status_history (changed_by = auth.uid(), changed_at), que ya
-- registra cada cambio de mls_published_at desde 20260927120000.
--
-- Idempotente. Aplicar SOLO con sign-off del owner (`supabase db push`). Rollback:
-- docs/superpowers/runbooks/rollback-20261018170000_properties_mls_published_at_guard.sql

begin;

-- ── 1. Nota en el historial ──────────────────────────────────────────────────────
alter table public.property_status_history add column if not exists note text;

comment on column public.property_status_history.note is
  'Motivo de una corrección de mls_published_at (obligatorio en ese caso). Lo fija '
  'correct_property_mls_published_at() en la transacción; null en los demás cambios.';

-- ── 2. El historial guarda la nota ───────────────────────────────────────────────
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
    old_expires_at, new_expires_at, changed_by, note)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.mls_status end, new.mls_status,
    case when tg_op = 'UPDATE' then old.mls_published_at end, new.mls_published_at,
    case when tg_op = 'UPDATE' then old.mls_expires_at end, new.mls_expires_at,
    case
      when v_role in ('authenticated', 'anon') then coalesce(auth.uid()::text, v_role)
      when v_role is null or v_role = 'none' then session_user::text
      else v_role
    end,
    nullif(btrim(current_setting('lixtara.status_note', true)), ''));
  return null;
end;
$$;

-- ── 3. Guard de la fecha de publicación ──────────────────────────────────────────
create or replace function public.guard_properties_mls_published_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_role text := current_setting('role', true);
  v_note text := btrim(coalesce(current_setting('lixtara.status_note', true), ''));
begin
  if v_role is null or v_role not in ('authenticated', 'anon', 'service_role') then
    return new;                       -- migraciones, operación manual: queda en el historial
  end if;

  if tg_op = 'INSERT' then
    if new.mls_published_at is not null then
      raise exception 'mls_published_at is set from the admin, never on insert.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.mls_published_at is not distinct from old.mls_published_at then
    return new;
  end if;

  if v_role <> 'authenticated' then
    raise exception 'Only a broker or admin can set mls_published_at.' using errcode = '42501';
  end if;
  if new.mls_published_at > now() + interval '5 minutes' then
    raise exception 'mls_published_at cannot be in the future.' using errcode = '22023';
  end if;

  if old.mls_published_at is null then
    -- Marcar como publicado.
    if not public.is_admin_or_broker() then
      raise exception 'Only a broker or admin can set mls_published_at.' using errcode = '42501';
    end if;
    if new.mls_number is null or btrim(new.mls_number) = '' then
      raise exception 'mls_published_at requires the MLS number.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.agreements a
                    where a.property_id = new.id and a.status = 'completed') then
      raise exception 'mls_published_at requires the listing agreement to be completed.'
        using errcode = '23514';
    end if;
    if not exists (select 1 from public.payments p
                    where p.property_id = new.id
                      and p.payment_type = 'flat_fee'
                      and p.tier is not null       -- la fotografía también es flat_fee, sin tier
                      and p.status = 'succeeded') then
      raise exception 'mls_published_at requires the plan payment to have succeeded.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Ya estaba fijada: solo un admin la corrige (o la borra), con nota.
  if not public.has_role('admin') then
    raise exception 'Only an admin can correct mls_published_at once it is set.'
      using errcode = '42501';
  end if;
  if char_length(v_note) < 10 then
    raise exception 'Correcting mls_published_at requires a note (at least 10 characters).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_properties_mls_published_at on public.properties;
create trigger guard_properties_mls_published_at
  before insert or update on public.properties
  for each row execute function public.guard_properties_mls_published_at();

revoke execute on function public.guard_properties_mls_published_at() from public, anon, authenticated;

-- ── 4. Corrección por un admin, con nota ─────────────────────────────────────────
create or replace function public.correct_property_mls_published_at(
  p_property_id uuid,
  p_published_at timestamptz,
  p_note text
)
  returns void
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only an admin can correct mls_published_at.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'Correcting mls_published_at requires a note (at least 10 characters).'
      using errcode = '23514';
  end if;
  perform set_config('lixtara.status_note', left(btrim(p_note), 2000), true);
  update public.properties set mls_published_at = p_published_at where id = p_property_id;
  if not found then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
  perform set_config('lixtara.status_note', '', true);
end;
$$;

revoke execute on function public.correct_property_mls_published_at(uuid, timestamptz, text) from public, anon;
grant execute on function public.correct_property_mls_published_at(uuid, timestamptz, text) to authenticated;

commit;

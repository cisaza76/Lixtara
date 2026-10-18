-- Rollback de 20261018170000_properties_mls_published_at_guard.
--
-- Quita el guard de mls_published_at y la función de corrección, y devuelve
-- log_property_status_change a su versión de 20260927120000 (sin nota). Tras el rollback la
-- broker o un admin pueden volver a escribir la fecha sin precondiciones ni nota (el
-- vendedor sigue bloqueado por guard_properties_seller_columns). CONSERVA:
--   - properties.mls_published_at y sus valores (la columna es del baseline),
--   - property_status_history y su columna note, con las notas ya escritas (el historial no
--     se borra). Para quitarla también: alter table public.property_status_history drop column note;
-- Para volver a aplicar: re-ejecutar la migración (es idempotente).

begin;

drop trigger if exists guard_properties_mls_published_at on public.properties;
drop function if exists public.guard_properties_mls_published_at();
drop function if exists public.correct_property_mls_published_at(uuid, timestamptz, text);

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

commit;

-- properties.mls_number: la anota la broker desde el panel de admin (bloqueo B).
--
-- `mls_number` es la clave con la que /properties suprime la ficha del feed IDX que
-- duplica un listing propio. Hasta ahora nada la escribía. Esta migración:
--
--   1. Añade el task_type `enter_mls_number`: al aprobar un listing sin número se crea la
--      tarea para anotarlo después de darlo de alta en Matrix.
--   2. PROTEGE la columna. La política "Users can update own properties" deja al vendedor
--      actualizar su fila entera, `mls_number` incluido. Con la columna ya cargada de
--      significado, un vendedor podría escribir el número de la ficha de OTRO broker y
--      hacerla desaparecer de /properties, o reclamarla como propia. El trigger solo
--      permite cambiarla a admin/broker (is_admin_or_broker) y a roles fuera de la API
--      (service_role del script de carga, superusuarios en operación manual).
--      Mismo patrón que guard_users_role_change (20260721200749).
--
-- Idempotente. Aplicar SOLO con sign-off del owner.

begin;

alter table public.broker_tasks drop constraint if exists broker_tasks_task_type_check;
alter table public.broker_tasks add constraint broker_tasks_task_type_check
  check (task_type = any (array[
    'approve_listing', 'review_offer', 'coordinate_closing', 'resolve_issue', 'follow_up',
    'enter_mls_number'
  ]::text[]));

-- NO security definer: current_user debe reflejar el rol de la petición (authenticated /
-- anon vía PostgREST). is_admin_or_broker() sí es definer y lee user_roles con auth.uid().
create or replace function public.guard_properties_mls_number()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin_or_broker() then
    if (tg_op = 'INSERT' and new.mls_number is not null)
       or (tg_op = 'UPDATE' and new.mls_number is distinct from old.mls_number) then
      raise exception 'properties.mls_number can only be set by a broker or admin.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_properties_mls_number on public.properties;
create trigger guard_properties_mls_number
  before insert or update of mls_number on public.properties
  for each row execute function public.guard_properties_mls_number();

commit;

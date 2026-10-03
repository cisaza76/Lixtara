-- Rollback de 20260926120100_mls_number_admin.sql
--
-- Antes de ejecutarlo: desplegar un código anterior a esta migración — el admin crea
-- tareas `enter_mls_number`, que el CHECK restaurado rechazaría.
--
-- ⚠️ Quitar el trigger devuelve al vendedor la capacidad de escribir properties.mls_number
-- en su propia fila (política "Users can update own properties"), y con ella la de ocultar
-- la ficha de otro broker en /properties. No hacerlo con la exhibición del MLS encendida.

begin;

drop trigger if exists guard_properties_mls_number on public.properties;
drop function if exists public.guard_properties_mls_number();

-- Las filas enter_mls_number impedirían restaurar el CHECK: se eliminan (su rastro queda
-- en activity_log como `mls_number_set` cuando el número se llegó a anotar).
delete from public.broker_tasks where task_type = 'enter_mls_number';

alter table public.broker_tasks drop constraint if exists broker_tasks_task_type_check;
alter table public.broker_tasks add constraint broker_tasks_task_type_check
  check (task_type = any (array[
    'approve_listing', 'review_offer', 'coordinate_closing', 'resolve_issue', 'follow_up'
  ]::text[]));

commit;

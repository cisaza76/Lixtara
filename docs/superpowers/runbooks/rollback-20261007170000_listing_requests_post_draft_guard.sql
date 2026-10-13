-- Rollback de 20261007170000_listing_requests_post_draft_guard.
--
-- Devuelve guard_properties_seller_columns a su versión de 20260927120000 (el vendedor
-- vuelve a editar directo un listing activo — el hueco de #136 reaparece). CONSERVA:
--   - listing_requests y sus filas (historial de solicitudes),
--   - los task_type nuevos en broker_tasks (quitarlos rompería si ya hay tareas de ese tipo),
--   - properties_seller_post_draft_columns() (sin uso tras el rollback; inofensiva).
-- Para volver a aplicar: re-ejecutar la migración (es idempotente).

begin;

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

commit;

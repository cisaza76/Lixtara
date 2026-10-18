-- Rollback de 20261018190000_mls_published_requires_active.
--
-- Devuelve guard_properties_mls_published_at a su versión de 20261018170000: marcar como
-- publicado vuelve a NO exigir mls_status = 'active' (número, acuerdo completed, pago del plan
-- y las reglas de corrección siguen). No toca datos. Para volver a aplicar: re-ejecutar la
-- migración (es idempotente).

begin;

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

revoke execute on function public.guard_properties_mls_published_at() from public, anon, authenticated;

commit;

-- Un vendedor no puede aprobar su propio listing.
--
-- EL HUECO
-- La política RLS "Users can update own properties" (USING auth.uid() = owner_id) no
-- restringe columnas: con la publishable key y su sesión, un vendedor podía hacer
--   update properties set mls_status = 'active' where id = <su listing>
-- y saltarse la aprobación del broker — sin pagar, sin acuerdo firmado, sin revisión. El
-- listing salía en /properties (política pública `mls_status = 'active'`) y aceptaba ofertas
-- (/api/offers solo exige `active`). También podía insertar una fila ya en `active`.
--
-- QUIÉN CAMBIA mls_status LEGÍTIMAMENTE (mapeado en el código el 2026-09-27)
--   draft            ← INSERT del asistente /listing/new (sesión del vendedor)
--   pending_approval ← webhook de Stripe tras el pago (service_role)
--   active / withdrawn / draft ← aprobar / rechazar / pedir cambios (sesión admin/broker)
-- Ningún camino del vendedor cambia el estado después de crear el borrador.
--
-- LA REGLA (trigger, mismo patrón que guard_users_role_change en 20260721200749)
-- Para los roles de la API (`authenticated`, `anon`) que NO son admin/broker:
--   - INSERT: solo con mls_status = 'draft'.
--   - UPDATE: mls_status, mls_published_at y mls_expires_at no pueden cambiar. Las dos
--     fechas son del mismo ciclo de publicación (hoy nada las escribe); se cierran ya para
--     que no nazcan abiertas.
-- service_role (webhook, scripts) y superusuarios no se ven afectados. El resto de columnas
-- del listing siguen editables por su dueño, como hasta ahora.
--
-- Idempotente. Aplicar SOLO con sign-off del owner (`supabase db push`).
-- Rollback: docs/superpowers/runbooks/rollback-20260927120000_guard_properties_mls_status.sql

begin;

-- NO security definer: current_user debe ser el rol de la petición. is_admin_or_broker()
-- sí es definer y lee user_roles con auth.uid().
create or replace function public.guard_properties_mls_status()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin_or_broker() then
    if tg_op = 'INSERT' then
      if new.mls_status is distinct from 'draft' then
        raise exception 'A new listing must start as draft; approval is done by a broker.'
          using errcode = '42501';
      end if;
    elsif new.mls_status is distinct from old.mls_status
       or new.mls_published_at is distinct from old.mls_published_at
       or new.mls_expires_at is distinct from old.mls_expires_at then
      raise exception 'Only a broker or admin can change a listing''s status.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_properties_mls_status on public.properties;
create trigger guard_properties_mls_status
  before insert or update of mls_status, mls_published_at, mls_expires_at on public.properties
  for each row execute function public.guard_properties_mls_status();

commit;

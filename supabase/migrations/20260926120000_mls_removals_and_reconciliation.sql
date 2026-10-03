-- Fichas vencidas del feed IDX: bajas del incremental + reconciliación diaria.
-- Plan: PR "MLS activation blockers" (bloqueo A). Runbook:
-- docs/superpowers/runbooks/2026-09-18-mls-idx-activacion.md
--
-- EL PROBLEMA
-- La ingesta pide solo fichas con estado y tipo mostrables. Una ficha que pasa a Closed,
-- Expired o Withdrawn deja de llegar y quedaba guardada como "Active" para siempre — y
-- la página pública la seguía mostrando. Schedule A exige retirarla en 24 h. Y una ficha
-- ELIMINADA del feed no genera ningún cambio que un incremental pueda ver.
--
-- LA SOLUCIÓN (código en src/lib/mls/sync-run.ts y reconcile-run.ts)
--   1. Cada pasada incremental, tras la ingesta, pide SOLO CLAVES de lo modificado que
--      ya no es mostrable y las BORRA (físico: sin uso permitido, y § VI.C obliga a
--      purgar igualmente). Nunca se guarda el payload de una ficha no mostrable.
--   2. Una vez al día se pide la lista completa de claves mostrables; lo guardado que no
--      esté en ella se borra — salvo lo que el incremental tocó DURANTE la reconciliación,
--      y nunca si la lista vino incompleta (< 80 % de lo guardado).
--
-- `mls_listings.withdrawn_at` queda SIN USO: nada lo escribe (el diseño es borrar, no
-- marcar). No se toca en esta migración; su retirada va aparte.
--
-- Idempotente. Tablas con RLS deny-all (sin políticas): las funciones son SECURITY
-- INVOKER y solo `service_role` puede ejecutarlas. Aplicar SOLO con sign-off del owner.

-- ── Estado de la pasada incremental ───────────────────────────────────────────────
alter table public.mls_sync_state
  -- Inicio de la pasada EN CURSO. last_modification_ts avanza a ESTE valor al terminar,
  -- aunque la pasada cruce varias invocaciones (antes avanzaba al inicio de la última,
  -- saltándose lo modificado entre la primera y la última). null = sin pasada a medias.
  add column if not exists pass_started_at timestamptz,
  add column if not exists pass_phase text not null default 'listings'
    check (pass_phase in ('listings', 'removals')),
  -- nextLink de la fase de bajas interrumpida (la de fichas usa resume_cursor).
  add column if not exists removal_cursor text,
  -- Total acumulado de filas borradas por el incremental (bajas + fuera de cobertura).
  add column if not exists incremental_removed_total bigint not null default 0;

-- ── Estado de la reconciliación ───────────────────────────────────────────────────
alter table public.mls_sync_state
  -- En curso: no null. Las filas tocadas por el incremental DESPUÉS de este instante
  -- (last_seen_at >= started_at) nunca se borran en el barrido.
  add column if not exists reconciliation_started_at timestamptz,
  add column if not exists reconciliation_cursor text,
  -- Claves mostrables Y en cobertura vistas hasta ahora en la reconciliación en curso.
  -- Se persiste junto con el cursor, en la misma escritura, para no contar dos veces.
  add column if not exists reconciliation_keys_seen bigint not null default 0,
  add column if not exists last_reconciliation_at timestamptz,
  add column if not exists last_reconciliation_status text
    check (last_reconciliation_status in ('ok', 'partial', 'aborted', 'failed')),
  add column if not exists last_reconciliation_deleted bigint not null default 0,
  -- Conteo guardado contra el que se evaluó la protección del 80 %, para auditarla.
  add column if not exists last_reconciliation_stored bigint,
  add column if not exists last_reconciliation_keys_seen bigint,
  add column if not exists last_reconciliation_error text;

-- ── Marca de confirmación por fila ─────────────────────────────────────────────────
-- La reconciliación reparte la lista en varias invocaciones, así que no puede tener las
-- ~40 k claves en memoria. En su lugar marca cada fila vista con el inicio de la
-- reconciliación; al cerrar, lo no marcado es lo que desapareció del feed.
alter table public.mls_listings
  add column if not exists last_confirmed_at timestamptz;

-- ── Funciones (POST con arreglo: una URL con 2.000 claves no cabe en PostgREST) ────
create or replace function public.mls_delete_listings(p_dataset text, p_keys text[])
  returns integer
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  delete from public.mls_listings where listing_key = any(p_keys);
  get diagnostics n = row_count;
  if n > 0 then
    update public.mls_sync_state
       set incremental_removed_total = incremental_removed_total + n,
           updated_at = now()
     where dataset = p_dataset;
  end if;
  return n;
end;
$$;

create or replace function public.mls_confirm_listings(p_keys text[], p_at timestamptz)
  returns integer
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update public.mls_listings set last_confirmed_at = p_at where listing_key = any(p_keys);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Barrido de la reconciliación. Borra SOLO lo que cumple AMBAS condiciones:
--   (a) no fue confirmado por esta reconciliación, y
--   (b) el incremental no lo tocó desde que empezó (last_seen_at < p_started_at).
-- (b) protege las fichas que entraron o se actualizaron mientras la lista se paginaba.
-- La protección del 80 % se evalúa en el código ANTES de llamar a esto.
create or replace function public.mls_reconcile_sweep(p_started_at timestamptz)
  returns integer
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  delete from public.mls_listings
   where (last_confirmed_at is null or last_confirmed_at < p_started_at)
     and last_seen_at < p_started_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Supabase concede EXECUTE a anon/authenticated por defecto: se retira explícitamente.
revoke all on function public.mls_delete_listings(text, text[]) from public, anon, authenticated;
revoke all on function public.mls_confirm_listings(text[], timestamptz) from public, anon, authenticated;
revoke all on function public.mls_reconcile_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.mls_delete_listings(text, text[]) to service_role;
grant execute on function public.mls_confirm_listings(text[], timestamptz) to service_role;
grant execute on function public.mls_reconcile_sweep(timestamptz) to service_role;

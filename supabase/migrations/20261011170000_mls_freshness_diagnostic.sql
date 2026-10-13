-- Diagnóstico de frescura de las fichas guardadas (Opción B, modo diagnóstico).
--
-- CONTEXTO: hasta el 2026-10-11 el sync incremental filtraba por ModificationTimestamp
-- (fecha del MLS). Bridge documenta que el campo correcto es BridgeModificationTimestamp,
-- así que pudieron quedar cambios de Bridge sin capturar. Esto MIDE cuántos, sin corregir.
--
-- CÓMO: la reconciliación diaria ya pagina todas las claves vigentes de Bridge; ahora
-- también pide BridgeModificationTimestamp y, por cada página, llama a esta función, que
-- compara esa fecha con la guardada en el payload de cada ficha y devuelve SOLO CONTEOS:
--   missing  · la clave está vigente en Bridge y en cobertura, pero no está guardada;
--   stale    · guardada con una fecha de Bridge más vieja que la actual, y el cambio tiene
--              más de 2 h (no es algo que el sync de cada hora aún no alcanzó);
--   recent   · desactualizada, pero el cambio es de las últimas 2 h (lo toma el sync);
--   current  · al día;
--   unknown  · sin fecha de un lado o del otro.
--
-- SOLO LECTURA: la función es STABLE y SECURITY INVOKER; no escribe ni devuelve
-- contenido de las fichas. La ejecuta solo service_role (las tablas son deny-all).
-- Los totales se guardan en mls_sync_state (reconciliation_freshness mientras corre,
-- last_reconciliation_freshness al cerrar).
--
-- Sin `$$` ni corchetes: se pega en el SQL Editor. `_text` es el nombre interno del tipo
-- arreglo de text (equivale a text con corchetes). Idempotente. Aplicar SOLO con sign-off.

alter table public.mls_sync_state
  add column if not exists reconciliation_freshness jsonb,
  add column if not exists last_reconciliation_freshness jsonb;

create or replace function public.mls_freshness_counts(p_keys _text, p_bridge_ts _text, p_recent_after timestamptz)
  returns table (missing integer, stale integer, recent integer, current integer, unknown integer)
  language sql
  stable
  security invoker
  set search_path = public, pg_temp
as '
  with b as (
    select u.k, nullif(u.ts, '''')::timestamptz as bridge_ts
      from unnest(p_keys, p_bridge_ts) as u(k, ts)
  ), j as (
    select b.bridge_ts,
           m.listing_key is not null as stored,
           nullif(m.payload->>''BridgeModificationTimestamp'', '''')::timestamptz as stored_ts
      from b left join public.mls_listings m on m.listing_key = b.k
  )
  select
    (count(*) filter (where not stored))::integer,
    (count(*) filter (where stored and bridge_ts is not null and stored_ts is not null
                        and stored_ts < bridge_ts and bridge_ts < p_recent_after))::integer,
    (count(*) filter (where stored and bridge_ts is not null and stored_ts is not null
                        and stored_ts < bridge_ts and bridge_ts >= p_recent_after))::integer,
    (count(*) filter (where stored and bridge_ts is not null and stored_ts is not null
                        and stored_ts >= bridge_ts))::integer,
    (count(*) filter (where stored and (bridge_ts is null or stored_ts is null)))::integer
  from j
';

revoke all on function public.mls_freshness_counts(_text, _text, timestamptz) from public, anon, authenticated;
grant execute on function public.mls_freshness_counts(_text, _text, timestamptz) to service_role;

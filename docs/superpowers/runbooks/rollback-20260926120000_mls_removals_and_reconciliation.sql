-- Rollback de 20260926120000_mls_removals_and_reconciliation.sql
--
-- Antes de ejecutarlo: apagar la sincronización (vercel env rm MLS_SYNC_ENABLED) y
-- desplegar un código anterior a esta migración — el worker actual escribe estas columnas
-- y llama a estas funciones, y fallaría sin ellas.
--
-- No borra fichas: solo el andamiaje de bajas y reconciliación. Tras esto, las fichas que
-- dejan de ser mostrables vuelven a quedarse guardadas (el problema que la migración
-- resolvía): no dejar la exhibición encendida en ese estado.

begin;

drop function if exists public.mls_reconcile_sweep(timestamptz);
drop function if exists public.mls_confirm_listings(text[], timestamptz);
drop function if exists public.mls_delete_listings(text, text[]);

alter table public.mls_listings drop column if exists last_confirmed_at;

alter table public.mls_sync_state
  drop column if exists pass_started_at,
  drop column if exists pass_phase,
  drop column if exists removal_cursor,
  drop column if exists incremental_removed_total,
  drop column if exists reconciliation_started_at,
  drop column if exists reconciliation_cursor,
  drop column if exists reconciliation_keys_seen,
  drop column if exists last_reconciliation_at,
  drop column if exists last_reconciliation_status,
  drop column if exists last_reconciliation_deleted,
  drop column if exists last_reconciliation_stored,
  drop column if exists last_reconciliation_keys_seen,
  drop column if exists last_reconciliation_error;

commit;

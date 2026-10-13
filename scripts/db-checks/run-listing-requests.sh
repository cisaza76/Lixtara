#!/usr/bin/env bash
# Verifica 20261007170000_listing_requests_post_draft_guard (#134, #136) en un Postgres
# DESECHABLE. Nunca toca producción. Sale con código 1 si algún caso no coincide.
#   pnpm db-check:listing-requests                     # Docker (postgres:17-alpine)
#   DB_CHECK_PSQL="psql -h /tmp -p 5432 -U postgres" pnpm db-check:listing-requests
#                                                      # o un Postgres local vacío ya levantado
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -n "${DB_CHECK_PSQL:-}" ]]; then
  # Solo un cluster DESECHABLE: la réplica crea los roles anon/authenticated/service_role
  # (globales al cluster) y aquí se borran al terminar.
  read -r -a BASE <<<"$DB_CHECK_PSQL"
  if [[ -n "$("${BASE[@]}" -tA -X -c "select 1 from pg_roles where rolname in ('anon','authenticated','service_role')")" ]]; then
    echo "El cluster ya tiene roles de Supabase: usa un Postgres vacío y desechable." >&2
    exit 2
  fi
  DB="lixtara_check_$$"
  "${BASE[@]}" -q -X -c "create database $DB" >/dev/null
  trap '"${BASE[@]}" -q -X -c "drop database if exists $DB" -c "drop role if exists anon" -c "drop role if exists authenticated" -c "drop role if exists service_role" >/dev/null 2>&1 || true' EXIT
  PSQL=("${BASE[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -X)
else
  NAME="lixtara-listing-requests-check-$$"
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
  trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
  until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
  sleep 1
  PSQL=(docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X)
fi

{
  # Réplica de Supabase + intento(): la parte común de la verificación de #133.
  awk '/^create table pg_temp.casos/{exit} {print}' scripts/db-checks/guard-properties-mls-status.sql
  cat <<'SQL'
-- Columnas que esta verificación usa y la réplica de #133 no tiene.
alter table public.properties
  add column show_phone_on_portals boolean default false,
  add column photos_rights_confirmed boolean default false,
  add column price_comps jsonb;
-- broker_tasks como en producción (baseline + 20260721200749 + 20260926120100).
create table public.broker_tasks (
  id uuid primary key default gen_random_uuid(), assigned_to uuid, transaction_id uuid,
  property_id uuid, task_type text not null, title text not null, description text,
  due_date date, priority text default 'medium', status text default 'pending',
  completed_at timestamptz, created_at timestamptz default now());
alter table public.broker_tasks enable row level security;
create policy "Brokers can manage all tasks" on public.broker_tasks for all to public
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());
grant all on public.broker_tasks to anon, authenticated, service_role;
set client_min_messages = warning;
SQL
  cat supabase/migrations/20260927120000_guard_properties_mls_status.sql
  cat supabase/migrations/20261007170000_listing_requests_post_draft_guard.sql
  # Idempotencia: aplicarla dos veces no falla.
  cat supabase/migrations/20261007170000_listing_requests_post_draft_guard.sql
  awk '/^\\i /{exit} {print}' scripts/db-checks/listing-requests.sql
  cat docs/superpowers/runbooks/rollback-20261007170000_listing_requests_post_draft_guard.sql
  awk 'f; /^\\i /{f=1}' scripts/db-checks/listing-requests.sql
} | "${PSQL[@]}"

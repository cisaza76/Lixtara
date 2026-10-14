#!/usr/bin/env bash
# Verifica 20261014150000_listing_funnel_view en un Postgres DESECHABLE (Docker). Nunca toca
# producción. Réplica mínima → migración (dos veces: idempotente) → casos → reversión → re-aplicación.
#   pnpm db-check:listing-funnel
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-listing-funnel-check-$$"
MIG=supabase/migrations/20261014150000_listing_funnel_view.sql
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1
psql_() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

{
  cat scripts/db-checks/crm-leads-replica.sql
  cat scripts/db-checks/listing-funnel-replica.sql
  echo "set client_min_messages = warning;"
  cat "$MIG"
  echo "-- idempotencia: la migración se puede aplicar dos veces"
  cat "$MIG"
  cat scripts/db-checks/listing-funnel.sql
} | psql_

# Reversión: borra la vista, conserva is_test (con default false para el código anterior)
{ echo "set client_min_messages = warning;"; cat scripts/sql/rollback_20261014150000_listing_funnel_view.sql; } | psql_
view=$(psql_ -A -t -c "select count(*) from pg_class where relname = 'listing_funnel_v'")
def=$(psql_ -A -t -c "select column_default from information_schema.columns where table_name='funnel_events' and column_name='is_test'")
rows=$(psql_ -A -t -c "select count(*) from public.funnel_events")
old=$(psql_ -A -t -c "insert into public.funnel_events (event) values ('legacy_insert') returning is_test")
[ "$view" = "0" ] && [ "$def" = "false" ] && [ "$rows" -gt 0 ] && [ "$old" = "f" ] || {
  echo "*** FALLA la reversión: vista=$view default=$def filas=$rows insert_viejo=$old"; exit 1; }
echo "reversión ok: vista borrada, eventos intactos ($rows filas), is_test conservado"

{ echo "set client_min_messages = warning;"; cat "$MIG"; } | psql_
echo "re-aplicación ok"

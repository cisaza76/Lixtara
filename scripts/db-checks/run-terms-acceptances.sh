#!/usr/bin/env bash
# Verifica 20261017120000_terms_acceptances en un Postgres DESECHABLE (Docker). Nunca toca
# producción. Réplica mínima → migración (dos veces: idempotente) → casos → reversión → re-aplicación.
#   pnpm db-check:terms-acceptances
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-terms-acceptances-check-$$"
MIG=supabase/migrations/20261017120000_terms_acceptances.sql
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
  echo "-- idempotencia"
  cat "$MIG"
  cat scripts/db-checks/terms-acceptances.sql
} | psql_
{ echo "set client_min_messages = warning;"; cat scripts/sql/rollback_20261017120000_terms_acceptances.sql; } | psql_
t=$(psql_ -A -t -c "select count(*) from pg_class where relname = 'terms_acceptances'")
[ "$t" = "0" ] || { echo "*** FALLA la reversión"; exit 1; }
echo "reversión ok"
{ echo "set client_min_messages = warning;"; cat "$MIG"; } | psql_
echo "re-aplicación ok"

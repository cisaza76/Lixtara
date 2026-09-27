#!/usr/bin/env bash
# Verifica 20260927120000_guard_properties_mls_status en un Postgres DESECHABLE (Docker).
# Nunca toca producción. Corre cada caso ANTES y DESPUÉS de aplicar la migración.
#   bash scripts/db-checks/run-guard-properties-mls-status.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-guard-check-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1

PSQL=(docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X)
{
  cat scripts/db-checks/guard-properties-mls-status.sql
  echo "select pg_temp.correr('antes');"
  cat supabase/migrations/20260927120000_guard_properties_mls_status.sql
  echo "select pg_temp.correr('despues');"
  echo "\\pset footer off"
  echo "select orden as \"#\", nombre as caso, antes, despues from pg_temp.casos order by orden;"
} | "${PSQL[@]}"

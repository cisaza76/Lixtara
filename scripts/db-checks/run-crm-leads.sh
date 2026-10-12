#!/usr/bin/env bash
# Verifica 20261012120000_crm_leads en un Postgres DESECHABLE (Docker). Nunca toca producción.
# Réplica mínima de Supabase → migración → casos de crm-leads.sql y de la carga de contactos
# (crm-contacts-*.sql alrededor de scripts/sql/crm_import_contacts.sql). Sale con código 1 si
# algún caso no coincide.
#   pnpm db-check:crm
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-crm-check-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1

{
  cat scripts/db-checks/crm-leads-replica.sql
  echo "set client_min_messages = warning;"
  cat supabase/migrations/20261012120000_crm_leads.sql
  cat scripts/db-checks/crm-leads.sql
  # Carga de contactos: el MISMO SQL que ejecuta scripts/import_contacts.py.
  cat scripts/db-checks/crm-contacts-before.sql
  cat scripts/sql/crm_import_contacts.sql
  cat scripts/db-checks/crm-contacts-after.sql
} | docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X

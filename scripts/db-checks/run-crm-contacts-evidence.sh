#!/usr/bin/env bash
# Verifica 20261013235500_crm_contacts_evidence en un Postgres DESECHABLE (Docker). Nunca toca
# producción. Réplica mínima → migraciones del CRM → casos → reversión → re-aplicación (idempotente).
#   pnpm db-check:crm-contacts
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-crm-contacts-check-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1
psql_() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

{
  cat scripts/db-checks/crm-leads-replica.sql
  echo "set client_min_messages = warning;"
  cat supabase/migrations/20261012120000_crm_leads.sql
  cat supabase/migrations/20261012180000_crm_sendable_view_grants.sql
  cat supabase/migrations/20261013235500_crm_contacts_evidence.sql
  echo "-- idempotencia: la migración se puede aplicar dos veces"
  cat supabase/migrations/20261013235500_crm_contacts_evidence.sql
  cat scripts/db-checks/crm-contacts-evidence.sql
} | psql_

# Reversión: deja el CRM previo intacto y sin rastro de los objetos nuevos
{
  echo "set client_min_messages = warning;"
  cat scripts/sql/rollback_20261013235500_crm_contacts_evidence.sql
} | psql_
left=$(psql_ -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('crm_persons','crm_entity_persons','crm_contacts',
  'crm_identity_evidence','crm_contact_validations','crm_contact_eligibility','crm_experiments',
  'crm_experiment_assignments','crm_contacts_current','crm_contacts_activable')")
cols=$(psql_ -A -t -c "select count(*) from information_schema.columns where table_name='crm_property_owners'
  and column_name in ('evidence_source','observed_on')")
owners=$(psql_ -A -t -c "select count(*) from public.crm_owners where owner_key like 'ev-%'")
[ "$left" = "0" ] && [ "$cols" = "0" ] && [ "$owners" = "5" ] || {
  echo "*** FALLA la reversión: objetos=$left columnas=$cols propietarios_previos=$owners"; exit 1; }
echo "reversión ok: 0 objetos nuevos, crm_owners intacto ($owners filas de prueba)"

# Re-aplicación después de revertir
{ echo "set client_min_messages = warning;"; cat supabase/migrations/20261013235500_crm_contacts_evidence.sql; } | psql_
echo "re-aplicación ok"

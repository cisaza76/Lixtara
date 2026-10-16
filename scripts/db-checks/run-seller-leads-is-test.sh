#!/usr/bin/env bash
# Verifica 20261016200000_seller_leads_is_test en un Postgres DESECHABLE (Docker). Nunca toca
# producción. Réplica mínima → filas "antes" → migración (dos veces: idempotente) → casos →
# insert del código anterior → reversión → re-aplicación.
#   pnpm db-check:seller-leads-is-test
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-seller-leads-check-$$"
MIG=supabase/migrations/20261016200000_seller_leads_is_test.sql
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1
psql_() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

# Réplica: solo las columnas que toca la migración (seller_leads como en 20261003004631).
psql_ <<'SQL'
create table public.properties (id uuid primary key, is_test boolean not null default false);
create table public.seller_leads (
  user_id uuid primary key,
  email text not null,
  property_id uuid references public.properties(id) on delete set null,
  status text not null default 'email_captured'
);
insert into public.properties values
  ('00000000-0000-0000-0000-0000000000a1', true),
  ('00000000-0000-0000-0000-0000000000a2', false);
insert into public.seller_leads (user_id, email, property_id) values
  ('00000000-0000-0000-0000-000000000001', 'test@example.com', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000002', 'real@example.com', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-000000000003', 'nodraft@example.com', null);
SQL

{ echo "set client_min_messages = warning;"; cat "$MIG"; cat "$MIG"; } | psql_

fail=0
check() { # nombre, consulta, esperado
  got=$(psql_ -A -t -c "$2")
  if [ "$got" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1: esperado '$3', obtuvo '$got'"; fail=1; fi
}
check "lead de propiedad is_test → prueba" \
  "select is_test from public.seller_leads where email='test@example.com'" "t"
check "lead de propiedad real → real" \
  "select is_test from public.seller_leads where email='real@example.com'" "f"
check "lead sin borrador → real (no se puede saber)" \
  "select is_test from public.seller_leads where email='nodraft@example.com'" "f"
check "columna NOT NULL default false" \
  "select is_nullable || ':' || column_default from information_schema.columns where table_name='seller_leads' and column_name='is_test'" "NO:false"
check "el insert del código anterior (sin is_test) sigue funcionando" \
  "insert into public.seller_leads (user_id, email) values ('00000000-0000-0000-0000-000000000004','old@example.com') returning is_test" "f"
check "el código nuevo puede marcar is_test" \
  "insert into public.seller_leads (user_id, email, is_test) values ('00000000-0000-0000-0000-000000000005','new@example.com', true) on conflict (user_id) do update set is_test = excluded.is_test returning is_test" "t"
[ "$fail" = 0 ] || exit 1

{ echo "set client_min_messages = warning;"; cat scripts/sql/rollback_20261016200000_seller_leads_is_test.sql; } | psql_
check "reversión: columna borrada, filas intactas" \
  "select (select count(*) from information_schema.columns where table_name='seller_leads' and column_name='is_test') || ':' || (select count(*) from public.seller_leads)" "0:5"
{ echo "set client_min_messages = warning;"; cat "$MIG"; } | psql_
echo "re-aplicación ok"
[ "$fail" = 0 ]

#!/usr/bin/env bash
# Verifica 20261017150000_buyer_agent_comp_offer en un Postgres DESECHABLE (Docker). Nunca toca
# producción. Réplica de Supabase de #133 + guard de #133/#136 → filas "antes" → migración (dos
# veces: idempotente) → casos → reversión → re-aplicación. Sale con 1 si algún caso falla.
#   pnpm db-check:buyer-comp
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="lixtara-buyer-comp-check-$$"
MIG=supabase/migrations/20261017150000_buyer_agent_comp_offer.sql
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -q; do sleep 0.5; done
sleep 1
psql_() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

{
  # Réplica de Supabase (roles, auth.uid(), has_role, properties con sus políticas) sin los casos de #133.
  awk '/^-- Ejecuta `stmt`/{exit} {print}' scripts/db-checks/guard-properties-mls-status.sql
  cat <<'SQL'
alter table public.properties
  add column buyer_agent_commission numeric(4,2) default 0,
  add column show_phone_on_portals boolean default false,
  add column photos_rights_confirmed boolean default false,
  add column price_comps jsonb;
-- broker_tasks como en producción (lo usa el guard de #136; igual que run-listing-requests.sh).
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
  # Filas "antes": oferta vieja de 2.5%, borrador sin elegir (0) y un valor fuera de rango.
  cat <<'SQL'
update public.properties set buyer_agent_commission = 2.5 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
update public.properties set buyer_agent_commission = 0   where id = 'aaaaaaaa-0000-4000-8000-000000000007';
update public.properties set buyer_agent_commission = 7   where id = 'aaaaaaaa-0000-4000-8000-000000000006';
SQL
  cat "$MIG"; cat "$MIG"
} | psql_

# Ejecuta SQL como un rol de la API (igual que PostgREST) y devuelve OK:<filas> o ERR:<sqlstate>.
psql_ <<'SQL'
create function public.intento(rol text, sub text, stmt text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  execute format('set local role %I', rol);
  begin
    execute stmt;
    get diagnostics n = row_count;
    reset role;
    return 'OK:' || n;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate;
  end;
end;
$$;
SQL

fail=0
check() { # nombre, consulta, esperado
  got=$(psql_ -A -t -c "$2" | tail -n 1)
  if [ "$got" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1: esperado '$3', obtuvo '$got'"; fail=1; fi
}
S="'11111111-1111-4111-8111-111111111111'"   # vendedor dueño de …001 (borrador)
O="'33333333-3333-4333-8333-333333333333'"   # otro vendedor, dueño de …007
B="'22222222-2222-4222-8222-222222222222'"   # broker
P1="'aaaaaaaa-0000-4000-8000-000000000001'"
P7="'aaaaaaaa-0000-4000-8000-000000000007'"

check "relleno: 2.5% viejo → percent" \
  "select buyer_agent_comp_type from public.properties where id = $P1" "percent"
check "relleno: 0 sin tipo → sin elegir" \
  "select coalesce(buyer_agent_comp_type, 'null') from public.properties where id = $P7" "null"
check "relleno: fuera de rango (7%) → sin tipo, no rompe la migración" \
  "select coalesce(buyer_agent_comp_type, 'null') from public.properties where id = 'aaaaaaaa-0000-4000-8000-000000000006'" "null"
check "el relleno no deja historial (las filas viejas no tienen versión de texto)" \
  "select count(*) from public.property_buyer_comp_history where terms_version is not null" "0"

check "vendedor: 0% (none) en su borrador" \
  "select public.intento('authenticated', $O, \$\$update public.properties set buyer_agent_comp_type='none', buyer_agent_commission=0, buyer_agent_comp_amount=null, buyer_agent_comp_terms_version='buyer_agent_comp@1' where id = $P7\$\$)" "OK:1"
check "vendedor: monto fijo" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='amount', buyer_agent_commission=0, buyer_agent_comp_amount=12000, buyer_agent_comp_terms_version='buyer_agent_comp@1' where id = $P1\$\$)" "OK:1"
check "vendedor: porcentaje personalizado 2.75" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='percent', buyer_agent_commission=2.75, buyer_agent_comp_amount=null where id = $P1\$\$)" "OK:1"
check "rechaza 'none' con % > 0" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='none', buyer_agent_commission=3 where id = $P1\$\$)" "ERR:23514"
check "rechaza % > 6" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='percent', buyer_agent_commission=6.5 where id = $P1\$\$)" "ERR:23514"
check "rechaza monto sin monto" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='amount', buyer_agent_commission=0, buyer_agent_comp_amount=null where id = $P1\$\$)" "ERR:23514"
check "rechaza un tipo desconocido" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='rebate' where id = $P1\$\$)" "ERR:23514"
check "otro vendedor no cambia una oferta ajena (RLS: 0 filas)" \
  "select public.intento('authenticated', $O, \$\$update public.properties set buyer_agent_comp_type='none', buyer_agent_commission=0, buyer_agent_comp_amount=null where id = $P1\$\$)" "OK:0"
check "después del borrador el vendedor ya no cambia la oferta (guard #136)" \
  "select public.intento('authenticated', $S, \$\$update public.properties set buyer_agent_comp_type='none', buyer_agent_commission=0 where id = 'aaaaaaaa-0000-4000-8000-000000000002'\$\$)" "ERR:42501"

check "historial: 3 cambios con fecha (none, amount, percent)" \
  "select string_agg(comp_type || ':' || coalesce(comp_pct::text, '-') || ':' || coalesce(comp_amount::text, '-'), ',' order by id) from public.property_buyer_comp_history" "none:-:-,amount:-:12000.00,percent:2.75:-"
check "historial: quién (auth.uid) y versión del texto" \
  "select count(*) from public.property_buyer_comp_history where changed_by in ($S, $O) and terms_version = 'buyer_agent_comp@1' and changed_at is not null" "3"
check "un cambio ajeno a la oferta no deja historial" \
  "select public.intento('authenticated', $S, \$\$update public.properties set description = 'x' where id = $P1\$\$) || '/' || (select count(*) from public.property_buyer_comp_history)" "OK:1/3"
check "vendedor no escribe el historial" \
  "select public.intento('authenticated', $S, \$\$insert into public.property_buyer_comp_history (property_id, comp_type, changed_by) values ($P1, 'none', 'x')\$\$)" "ERR:42501"
check "vendedor no borra el historial" \
  "select public.intento('authenticated', $S, \$\$delete from public.property_buyer_comp_history\$\$)" "ERR:42501"
check "vendedor ve solo el historial de SUS propiedades" \
  "select public.intento('authenticated', $S, \$\$select 1 from public.property_buyer_comp_history\$\$)" "OK:2"
check "broker ve todo el historial" \
  "select public.intento('authenticated', $B, \$\$select 1 from public.property_buyer_comp_history\$\$)" "OK:3"
check "anon no ve el historial" \
  "select public.intento('anon', null, \$\$select 1 from public.property_buyer_comp_history\$\$)" "ERR:42501"
check "lista del vendedor incluye las 3 columnas nuevas" \
  "select count(*) from unnest(public.properties_seller_writable_columns()) c where c in ('buyer_agent_comp_type','buyer_agent_comp_amount','buyer_agent_comp_terms_version')" "3"
[ "$fail" = 0 ] || exit 1

{ echo "set client_min_messages = warning;"; cat scripts/sql/rollback_20261017150000_buyer_agent_comp_offer.sql; } | psql_
check "reversión: columnas, tabla y trigger fuera; filas intactas" \
  "select (select count(*) from information_schema.columns where table_name='properties' and column_name like 'buyer_agent_comp_%') || ':' || (select count(*) from pg_tables where tablename='property_buyer_comp_history') || ':' || (select count(*) from public.properties)" "0:0:4"
check "reversión: la lista del vendedor vuelve a la de #133" \
  "select count(*) from unnest(public.properties_seller_writable_columns()) c where c like 'buyer_agent_comp_%'" "0"
{ echo "set client_min_messages = warning;"; cat "$MIG"; } | psql_
echo "re-aplicación ok"
[ "$fail" = 0 ]

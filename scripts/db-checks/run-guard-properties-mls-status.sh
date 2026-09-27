#!/usr/bin/env bash
# Verifica 20260927120000_guard_properties_mls_status en un Postgres DESECHABLE (Docker).
# Nunca toca producción. Corre cada caso ANTES y DESPUÉS de aplicar la migración, compara
# el resultado DESPUÉS con el esperado y sale con código 1 si alguno no coincide.
#   pnpm db-check:mls-status-guard
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
  echo "set client_min_messages = warning;"
  cat supabase/migrations/20260927120000_guard_properties_mls_status.sql
  echo "select pg_temp.correr('despues');"
  cat <<'SQL'
\pset footer off
\echo
\echo '== CASOS (esperado = resultado DESPUÉS de la migración)'
select orden as "#", grupo, nombre as caso, antes, despues, esperado,
       case when despues like esperado || '%' then 'ok' else '*** FALLA ***' end as veredicto
  from pg_temp.casos order by orden;

-- Acciones reales (confirmadas) para ver el historial y la lectura pública.
select pg_temp.intento('authenticated', '11111111-1111-4111-8111-111111111111',
  $$insert into public.properties (id, owner_id) values ('aaaaaaaa-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111')$$);
select pg_temp.intento('service_role', null,
  $$update public.properties set mls_status = 'pending_approval' where id = 'aaaaaaaa-0000-4000-8000-0000000000f1'$$);
select pg_temp.intento('authenticated', '22222222-2222-4222-8222-222222222222',
  $$update public.properties set mls_status = 'active' where id = 'aaaaaaaa-0000-4000-8000-0000000000f1'$$);
select pg_temp.intento('authenticated', '22222222-2222-4222-8222-222222222222',
  $$update public.properties set list_price = 1 where id = 'aaaaaaaa-0000-4000-8000-0000000000f1'$$);
update public.properties set mls_status = 'withdrawn' where id = 'aaaaaaaa-0000-4000-8000-0000000000f1';

\echo '== HISTORIAL de aaaaaaaa-…-f1 (crear → pagar → aprobar → editar precio → retirar)'
select old_status, new_status, changed_by from public.property_status_history
 where property_id = 'aaaaaaaa-0000-4000-8000-0000000000f1' order by id;

\echo '== LECTURA PÚBLICA: activos visibles para anon, con y sin is_test'
update public.properties set mls_status = 'active', is_test = false where id = 'aaaaaaaa-0000-4000-8000-000000000006';
update public.properties set mls_status = 'active', is_test = true  where id = 'aaaaaaaa-0000-4000-8000-000000000002';
set role anon;
select id, is_test from public.properties order by id;
reset role;

do $$ begin
  if exists (select 1 from pg_temp.casos where despues not like esperado || '%') then
    raise exception 'HAY CASOS QUE NO COINCIDEN CON LO ESPERADO';
  end if;
end $$;
SQL
} | "${PSQL[@]}"

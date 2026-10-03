# Runbook — Despliegue de #132 y #133 (guard del vendedor)

**Fecha:** 2026-09-27 · **Estado:** listo, **NO ejecutado** — espera el "adelante" del owner.
**PRs:** #132 (MLS: bajas, `mls_number`, interruptores, barrera IA) · #133 (lista de columnas
del vendedor, historial de estado, pagos/acuerdos, `is_test`).

Conexión usada en todos los pasos (pooler de sesión; credenciales en `.env.local`):

```bash
cd /Users/camiloisaza/Code/lixtara
set -a; source .env.local; set +a
export PGURL="postgresql://postgres.fizhoufepowilbhbtfkg@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
alias prod='PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$PGURL" -X -v ON_ERROR_STOP=1'
```

---

## a) Merge de #132 y sus migraciones

```bash
gh pr merge 132 --squash
git checkout main && git pull
supabase db push --dry-run   # debe listar SOLO:
                             #   20260926120000_mls_removals_and_reconciliation
                             #   20260926120100_mls_number_admin
supabase db push
```

Verificación: pasos 1.1 de `2026-09-18-mls-idx-activacion.md` (RLS deny-all, funciones solo
`service_role`, trigger `guard_properties_mls_number`). El feed sigue **apagado**: no se tocan
variables de Vercel en este despliegue.

## b) Migración de #133 en producción (ANTES del merge de #133)

La migración es compatible con el código de `main` (todos sus flujos pasan en Docker). El
código de #133 lee `properties.is_test`, así que la columna tiene que existir antes de que
ese código se despliegue.

```bash
git fetch origin fix/seller-self-approval
git checkout origin/fix/seller-self-approval -- supabase/migrations/20260927120000_guard_properties_mls_status.sql
supabase db push --dry-run   # debe listar SOLO 20260927120000_guard_properties_mls_status
supabase db push
git checkout main -- supabase/migrations/   # deja main limpio; el archivo llega con el merge
```

Verificación:

```sql
select tgname, tgenabled from pg_trigger
 where tgrelid = 'public.properties'::regclass
   and tgname in ('guard_properties_seller_columns','log_property_status_change','guard_properties_mls_number');
-- 3 filas, tgenabled = 'O'

select count(*) from public.properties where is_test;          -- 11
select count(*) from public.properties where is_test and mls_status = 'active';  -- 0

select has_table_privilege('authenticated', 'public.property_status_history', 'insert'),
       has_table_privilege('authenticated', 'public.property_status_history', 'delete');
-- f, f
```

## c) Verificación con el código actual

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lixtara.com/en/properties   # 200
```

Webhook de Stripe en modo test — una compra de prueba de punta a punta **con un listing
`is_test = true`** creado para esto (nunca con uno real):

1. Crear el listing de prueba como admin (`service_role`), dueño = usuario vendedor de prueba,
   `mls_status = 'draft'`, `pricing_tier = 'pro'`, `is_test = true`.
2. Pagar con la tarjeta de prueba `4242 4242 4242 4242` desde `/listing/new` (paso 8).
3. Comprobar:

```sql
select mls_status, pricing_tier from public.properties where id = '<listing de prueba>';
-- pending_approval, pro   (el webhook movió el estado y fijó el tier cobrado)
select old_status, new_status, changed_by from public.property_status_history
 where property_id = '<listing de prueba>' order by id;
-- draft → pending_approval, changed_by = service_role
```

## d) Merge de #133

```bash
gh pr merge 133 --squash
```

Tras el deploy de Vercel: `curl … /en/properties` → 200 otra vez.

## e) Prueba rápida en producción

Con el mismo listing de prueba (`is_test = true`, en `pending_approval`):

1. **El vendedor no puede activarlo** — con su sesión y la publishable key (supabase-js):
   `update properties set mls_status = 'active' where id = '<listing>'` → error `42501`
   *"Only a broker or admin can change: mls_status"*.
2. **El admin sí puede aprobarlo** — desde `/admin/listings/<id>/review` → "Approve".
3. Comprobar el historial:

```sql
select old_status, new_status, changed_by, changed_at from public.property_status_history
 where property_id = '<listing de prueba>' order by id;
-- … pending_approval → active, changed_by = <uuid del admin>
```

4. Retirar el listing de prueba (`withdrawn`) desde el admin. Queda en el historial.

---

## Rollback de #133 — desactivar sin perder datos

Apaga los dos triggers nuevos; **conserva** `property_status_history`, `properties.is_test`
y las políticas nuevas. Probado en Docker (`pnpm db-check:mls-status-guard`, fase ROLLBACK).

```bash
prod -f docs/superpowers/runbooks/rollback-20260927120000_guard_properties_mls_status.sql
```

Debe terminar mostrando ambos triggers con `tgenabled = 'D'`. Mientras estén apagados, el
hueco original vuelve (el vendedor puede activar su listing) y no se registra historial:
reactivar en cuanto se corrija el fallo:

```bash
prod -c "alter table public.properties enable trigger guard_properties_seller_columns;
         alter table public.properties enable trigger log_property_status_change;"
```

Si el fallo fuera del **código** de #133 y no de la base: revertir el merge en GitHub
(`gh pr revert`) basta; la migración es compatible con el código anterior y puede quedarse.

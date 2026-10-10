# Runbook — Activación del feed IDX de MIAMI

**Fecha:** 2026-09-18 · **Revisado:** 2026-09-26 (activación en 3 fases) · **Estado:** Fase 1
**ejecutada el 2026-10-10** (50.836 fichas, reconciliación ok, exhibición apagada)
**Dataset:** `miamire` — Miami Association of REALTORS® · acceso **APROBADO** y verificado
**PRs:** #129 (adaptador, worker, lectura pública) · #130 (convergencia) · #131 (solo
residencial) · PR de bloqueos de activación (bajas + reconciliación, `mls_number`,
interruptores separados, barrera IA)

> **Corrección respecto a versiones anteriores.** Este runbook decía que "`withdrawn_at`
> cubre lo retirado". **Era falso:** nada escribe esa columna. Una ficha que pasaba a
> Closed/Expired/Withdrawn dejaba de llegar (la ingesta filtra por estado) y quedaba
> guardada como `Active`. Ahora se **borra**: por la consulta de bajas de cada pasada
> incremental y por la reconciliación diaria. `mls_listings.withdrawn_at` queda **sin uso**
> (se conserva la columna; retirarla va aparte).

---

## Cifras reales del feed, medidas el 2026-09-18

Importan porque definen qué es "normal" en la primera pasada.

| | |
|---|---|
| Fichas totales en el feed | **1.438.500** |
| De las cuales `Closed` (histórico 7 años) | **1.327.107** — el 92 % |
| 4 estados públicos, cualquier tipo | ~94.000 |
| **Lo que ingerimos** (+ solo `PropertyType = Residential`) | **59.943** |
| Tras el filtro de condado (Miami-Dade · Broward · Palm Beach) | **~81 %** → **~48.500 filas** |
| Modificadas en 24 h | ~17.000 → **~4.250 por pasada de 6 h** |
| Velocidad observada | 200 fichas / ~0,5 s |

**Reparto de `PropertyType` en el feed** (medido sobre 2.000 fichas de los 4 estados
públicos) — solo entra la primera fila:

| Tipo | % | Precio mediano |
|---|---|---|
| **`Residential`** ✓ | 43,1 % | $499.000 |
| `Residential Lease` | 26,2 % | $3.500 |
| `Land/Boat Docks` | 12,5 % | $48.800 |
| `Commercial Sale` | 10,0 % | — |
| `Commercial Land` | 4,2 % | — |
| `Business Opportunity` | 2,9 % | — |
| `Residential Income` | 1,1 % | — |

**Reparto de condados en 1.000 fichas reales:** Miami-Dade 342 · Palm Beach 333 · Broward
141 · fuera de cobertura 157 · sin condado 27.

---

## Antes de empezar

- [ ] PR de bloqueos de activación **mergeado** a `main`
- [ ] `MLS_BRIDGE_SERVER_TOKEN` en Vercel **Production** (ya está)
- [ ] `MLS_FEED_ENABLED` **NO** puesta en ningún entorno. Es el flag viejo: abre sincronización
      Y exhibición a la vez. Si existiera, bórrala — con los flags nuevos no hace falta.
- [ ] `MLS_SYNC_ENABLED` y `MLS_DISPLAY_ENABLED` **no** puestas todavía

### Los tres interruptores

| Variable | Abre | Se pone en |
|---|---|---|
| `MLS_SYNC_ENABLED=true` | token de Bridge + `/api/mls/sync` + `/api/mls/reconcile` | Fase 1 |
| `MLS_DISPLAY_ENABLED=true` | fichas del feed en `lixtara.com/properties` (+ chequeo de host) | Fase 3 |
| `MLS_FEED_ENABLED` | (viejo) ambas, solo si la nueva correspondiente **no está definida** | nunca |

Todas **solo Production**: el acuerdo licencia el feed para `lixtara.com` y nada más
(Schedule B §1). El gate lo hace cumplir; ponerlas en otro entorno sigue siendo una mala
configuración.

---

# FASE 1 — Solo sincronización

Objetivo: llenar `mls_listings`, verificar que converge y que las bajas y la reconciliación
funcionan, **sin publicar nada**. `/properties` sigue mostrando solo listings propios.

## 1.1 · Aplicar las migraciones

**Requiere sign-off del owner** — convención del repo: nunca `db push` sin autorización.

```bash
cd /Users/camiloisaza/Code/lixtara
supabase db push --dry-run   # debe listar SOLO estas dos:
                             #   20260926120000_mls_removals_and_reconciliation
                             #   20260926120100_mls_number_admin
supabase db push
```

(`20260916140000_mls_idx_feed` ya está aplicada — verificado el 2026-09-26.)

Verificar RLS deny-all y que las funciones nuevas NO son ejecutables desde la API pública:

```sql
select tablename, rowsecurity from pg_tables
 where schemaname='public' and tablename in ('mls_listings','mls_sync_state');
-- ambas rowsecurity = true

select tablename, count(*) as policies from pg_policies
 where schemaname='public' and tablename in ('mls_listings','mls_sync_state')
 group by tablename;
-- CERO filas es lo correcto

select p.proname, r.rolname,
       has_function_privilege(r.rolname, p.oid, 'execute') as puede
  from pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
 where p.proname in ('mls_delete_listings','mls_confirm_listings','mls_reconcile_sweep')
 order by 1, 2;
-- anon y authenticated = false; service_role = true

select tgname from pg_trigger where tgname = 'guard_properties_mls_number';
-- 1 fila
```

## 1.2 · Variables (solo sincronización)

```bash
vercel env add MLS_SYNC_ENABLED production      # valor: true
vercel env add MLS_BRIDGE_DATASET production    # valor: miamire
vercel --prod                                   # redeploy para que las rutas las vean
```

**NO** pongas `MLS_DISPLAY_ENABLED`.

## 1.3 · Primera carga, disparada a mano

**No esperes al cron.** La carga inicial (`since` null) **no** ejecuta la consulta de bajas.

```bash
curl -s -X POST https://lixtara.com/api/mls/sync \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

### Qué debe devolver

```json
{
  "completed": false,
  "stoppedBy": "time_budget",
  "pages": 100,
  "received": 20000,
  "upserted": 16000,
  "removed": 0,
  "needsAttention": false
}
```

**La primera llamada NO va a completar, y eso es correcto.** Son ~300 páginas y en 50 s
caben ~100. Guarda dónde quedó y la siguiente invocación continúa. Repite el `curl` hasta
que salga `"completed": true` — tres veces, aproximadamente.

**Rangos esperados (acumulados de toda la carga):**

| Campo | Normal | Qué significa si se sale |
|---|---|---|
| `pages` | ~300 | Muchas más: algún filtro no se aplicó |
| `received` | ~60.000 | ~94.000: falta el filtro de tipo · ~1,4 M: falta el de estado — **abortar** |
| `upserted` | ~81 % de `received` | Mucho menos: el filtro de condado rechaza de más |
| `removed` | 0 en la carga inicial; algunos (fuera de cobertura ya guardados) después | — |
| `completed` | `true` al final | `false` → ver abajo |
| `needsAttention` | `false` | `true` → ver el log estructurado |

> **Medido el 2026-10-10:** la carga inicial necesitó ~14 invocaciones, no 3; tras las dos
> primeras cada una bajó solo 2.000–4.500 fichas. Por eso el cron pasó de cada 6 h a cada
> hora: con ~4.250 cambios cada 6 h, una sola invocación cada 6 h podía quedarse atrás.
> `records_seen` solo se escribe al completar una pasada y cuenta la última invocación.

### Pasada incompleta no es un fallo

`completed: false` con `stoppedBy: "time_budget"` o `"max_pages"` es el diseño: la pasada
guardó dónde quedó. El cursor de tiempo no avanza hasta completarla, y cuando avanza lo hace
al **inicio de la pasada** (`pass_started_at`), no al de la última invocación.

Lo que **sí** es un problema: que una pasada parcial no deje ni `resume_cursor` ni
`removal_cursor` — significaría que la próxima reempieza y **no convergería nunca**.

```sql
select dataset, last_run_status, records_seen, last_modification_ts,
       pass_started_at, pass_phase,
       (resume_cursor is not null) as reanuda_fichas,
       (removal_cursor is not null) as reanuda_bajas,
       incremental_removed_total,
       left(coalesce(last_error,''), 120) as error
  from public.mls_sync_state;
```

## 1.4 · Verificar lo ingerido

```sql
-- Condados: solo deben aparecer los tres.
select payload->>'CountyOrParish' as condado, count(*)
  from public.mls_listings group by 1 order by 2 desc;

-- Estados: NO debe haber Closed, Expired, Withdrawn, Canceled.
select mls_status, count(*) from public.mls_listings group by 1 order by 2 desc;

-- Tipos: SOLO Residential.
select payload->>'PropertyType' as tipo, count(*)
  from public.mls_listings group by 1 order by 2 desc;

-- Atribución: obligatoria en toda ficha de tercero (Schedule A §9).
select count(*) filter (where list_office_name is null) as sin_oficina, count(*) as total
  from public.mls_listings;
```

`sin_oficina` > 0 no es un fallo: `listingAttribution` degrada a texto genérico en vez de
omitir la línea, porque **omitirla es el incumplimiento**.

**Formato real de los números de MLS** — para contrastar el validador del panel de admin
(`MLS_NUMBER_PATTERN` en `src/lib/listing-mls-number.ts`: 1–2 letras, guion opcional, 6–10
dígitos):

```sql
select regexp_replace(listing_id, '[0-9]', '9', 'g') as patron, count(*)
  from public.mls_listings group by 1 order by 2 desc limit 10;
```

Si aparece un patrón que el validador rechazaría, ajustar el patrón **antes** de la Fase 3.

## 1.5 · Control negativo: nada se publica

Con la sincronización encendida y la exhibición apagada, `/properties` no muestra NADA del
feed, ni siquiera en el host licenciado:

```bash
curl -s https://lixtara.com/en/properties   | grep -c "courtesy of"   # debe ser 0
curl -s https://lixtara.com/en/properties   | grep -c "SEFMLS"        # debe ser 0
curl -s https://lixtara.vercel.app/en/properties | grep -c "courtesy of"   # debe ser 0
```

Si alguno **no** es 0: `vercel env rm MLS_SYNC_ENABLED production && vercel --prod` y revisar
que no exista `MLS_FEED_ENABLED`.

## 1.6 · Primera reconciliación, disparada a mano

Tras completar la carga. Pide solo claves del universo mostrable (~60.000 → **~30 páginas**
de 2.000, el `$top` máximo verificado de Bridge) y borra lo que ya no está.

```bash
curl -s -X POST https://lixtara.com/api/mls/reconcile \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

```json
{ "outcome": "ok", "stoppedBy": "completed", "pages": 30, "keysSeen": 48500,
  "stored": 48500, "deleted": 0, "needsAttention": false }
```

- `outcome: "partial"` → no le alcanzó el presupuesto de 50 s; repite el `curl`, continúa
  donde quedó. Estimado: **1–2 invocaciones** (≈30 páginas de solo claves; medir aquí la
  duración real por página y anotarla en este runbook).
- `outcome: "aborted"` → **protección del 80 %**: la lista trajo menos del 80 % de lo
  guardado. **No se borró nada.** Investigar antes de repetir (feed parcial, filtro roto,
  cambio de nombre de campo). El motivo está en `last_reconciliation_error`.
- `outcome: "not_due"` → ya corrió hace menos de 20 h.

```sql
select last_reconciliation_at, last_reconciliation_status, last_reconciliation_deleted,
       last_reconciliation_keys_seen, last_reconciliation_stored,
       left(coalesce(last_reconciliation_error,''), 160) as error,
       reconciliation_started_at, (reconciliation_cursor is not null) as en_curso
  from public.mls_sync_state;
```

## 1.7 · Dejar correr los crons (≥ 24 h)

| Cron | Horario (UTC) | Qué hace |
|---|---|---|
| `/api/mls/sync` | `23 * * * *` — cada hora (era cada 6 h hasta el 2026-10-10) | fichas modificadas + **bajas** |
| `/api/mls/reconcile` | `7,22,37,52 8-10 * * *` — 12 intentos en la ventana 08–10 UTC | una reconciliación al día; cada intento continúa el anterior o no hace nada (`not_due`) |

Plan de Vercel del proyecto: **Pro** (verificado 2026-09-26), que permite crons con
precisión de minutos; el worker de video ya corre cada 5 min en producción. Tres crons y
~16 invocaciones MLS al día.

En régimen: `records_seen` ~4.000–5.000 por pasada; `incremental_removed_total` sube cada
día (ventas, expiraciones); `last_reconciliation_deleted` pequeño (fichas eliminadas del
feed). **No pasar a la Fase 2 sin al menos un día completo de crons en verde.**

---

# FASE 2 — Revisión de `Media` y construcción de C (fotos)

Objetivo: decidir C con el payload REAL. **Sin publicar nada todavía.** El worker guarda el
payload completo en `mls_listings.payload`; si Bridge trae `Media`, ya está ahí.

```sql
-- ¿Cuántas fichas traen Media y cuántas fotos?
select count(*) filter (where payload ? 'Media') as con_media,
       count(*) as total,
       percentile_cont(0.5) within group (order by jsonb_array_length(payload->'Media'))
         filter (where jsonb_typeof(payload->'Media') = 'array') as fotos_mediana
  from public.mls_listings;

-- Campos de un elemento de Media (nombres, no valores).
select distinct jsonb_object_keys(payload->'Media'->0) as campo
  from public.mls_listings where jsonb_typeof(payload->'Media') = 'array' limit 50;

-- Hosts de las URLs: define el `images.remotePatterns` y confirma que es el CDN del MLS.
select split_part(split_part(payload->'Media'->0->>'MediaURL', '://', 2), '/', 1) as host, count(*)
  from public.mls_listings group by 1 order by 2 desc;
```

> **C construido el 2026-10-10** (PR "MLS photos by hot-link"): `primaryMlsPhotoUrl` en
> `src/lib/mls/public-listings.ts` elige la de menor `Order` entre `MediaCategory` "Photo"
> (o sin categoría) con `MediaURL` https; la tarjeta la pinta con `<img>` simple
> (`photo-hotlink.test.ts` prohíbe next/image y nuevos `remotePatterns`). Las consultas de
> arriba siguen siendo la verificación previa a la Fase 3: si los nombres de campo no son
> `MediaURL` / `Order` / `MediaCategory`, ajustar la función antes de encender la exhibición.

Con eso se construye C (en su propio PR): foto principal por hot-link al CDN del MLS (sin
descargar ni guardar), imagen de reemplazo si no hay, `loading="lazy"` y dimensiones fijas,
revisado a 375 px. **Recordatorio § III.B.4:** ninguna imagen del feed puede pasar por
visión, staging ni Media Agent.

---

# FASE 3 — Visualización

Requisitos: Fase 1 estable · C mergeado · números MLS de los listings propios cargados.

## 3.1 · Cargar `mls_number` de los listings propios activos

La broker llena un CSV (`property_id,mls_number`) con los números **de Matrix** — nada se
deduce del feed:

```sql
-- Qué falta: listings propios activos sin número.
select id, address_street, address_city from public.properties
 where mls_status = 'active' and mls_number is null order by address_street;
```

```bash
pnpm mls:backfill-numbers -- numeros.csv            # dry-run: valida y muestra el plan
pnpm mls:backfill-numbers -- numeros.csv --apply    # escribe (todo o nada)
```

A futuro, cada aprobación pide el número (opcional) y, si falta, crea la tarea de broker
`enter_mls_number`; se anota en la página de revisión del listing.

## 3.2 · Verificar la deduplicación con datos reales

```sql
-- Listings propios que el feed también trae: cada fila es una supresión que /properties
-- debe aplicar (renderiza la fila propia, no la del feed).
select p.id, p.address_street, p.mls_number, m.listing_key
  from public.properties p
  join public.mls_listings m
    on upper(regexp_replace(m.listing_id, '\s', '', 'g')) = p.mls_number
 where p.mls_status = 'active';

-- Propios activos CON número que el feed NO trae (¿número mal tecleado? ¿fuera de cobertura?).
select p.id, p.address_street, p.mls_number
  from public.properties p
 where p.mls_status = 'active' and p.mls_number is not null
   and not exists (select 1 from public.mls_listings m
                    where upper(regexp_replace(m.listing_id, '\s', '', 'g')) = p.mls_number);
```

La segunda consulta debería salir vacía; cada fila es un listing que saldría **duplicado**.

## 3.3 · Encender la exhibición

```bash
vercel env add MLS_DISPLAY_ENABLED production   # valor: true
vercel --prod
```

```bash
curl -s https://lixtara.com/en/properties | grep -c "courtesy of"    # > 0
curl -s https://lixtara.com/es/properties | grep -c "cortesía de"    # > 0
curl -s https://lixtara.com/en/properties | grep -c "SEFMLS"         # = 1
curl -s https://lixtara.com/en/properties | grep -c "MIAMI REALTORS" # = 1
```

Control negativo — **el mismo deployment de producción en un host no licenciado**:

```bash
curl -s https://lixtara.vercel.app/en/properties | grep -c "courtesy of"   # debe ser 0
```

Si **no** es 0: `vercel env rm MLS_DISPLAY_ENABLED production && vercel --prod` de inmediato.

Y a ojo en `lixtara.com/properties`: ninguna ficha de otro broker muestra precio de Lixtara
ni "ahorro"; los listings propios aparecen una sola vez.

---

## Interruptores de emergencia

```bash
# Dejar de PUBLICAR (la sincronización sigue; los datos se mantienen al día):
vercel env rm MLS_DISPLAY_ENABLED production && vercel --prod

# Dejar de SINCRONIZAR (y de reconciliar):
vercel env rm MLS_SYNC_ENABLED production && vercel --prod
```

Ambos son fail-closed. ⚠️ Apagar **solo** la sincronización con la exhibición encendida deja
la página mostrando datos que envejecen: a las 24 h las fichas vendidas o retiradas
incumplen Schedule A. Si la sincronización va a estar apagada más de unas horas, apagar
también la exhibición.

Los datos ingeridos siguen en la tabla. Para purgarlos —§ VI.C al terminar el acuerdo— está
`docs/superpowers/runbooks/rollback-20260916140000_mls_idx_feed.sql`, con la advertencia de
que `DROP` no alcanza los backups PITR de Supabase.

---

## Qué vigilar la primera semana

| Señal | Dónde | Umbral |
|---|---|---|
| `needsAttention: true` | respuesta y log `mls_sync_run` / `mls_reconcile_run` | cualquiera |
| `county_field_missing` alto | `excluded` en `mls_sync_run` | >50 % de `received` |
| Pasadas `partial` encadenadas | `last_run_status` | más de 2 seguidas |
| Reconciliación `aborted` | `last_reconciliation_status` | cualquiera — no se borró nada |
| Reconciliación sin cerrar | `last_reconciliation_at` | > 30 h |
| Borrado grande | `last_reconciliation_deleted` / `stored` | > 10 % (el log lo marca) |

Los logs `mls_sync_run` y `mls_reconcile_run` **nunca llevan una ficha ni una clave**: solo
conteos y motivos.

---

## Lo que este runbook NO cubre

- **Comparables del vendedor.** Necesitan datos `Closed`, que el worker deliberadamente no
  ingiere (1,3 M de fichas, el 92 % del feed). El diseño propuesto es una consulta **bajo
  demanda**. Rentcast sigue en pie hasta entonces.
- **`mls_listings.withdrawn_at`** — sin uso. Nada lo escribe; el diseño es borrar. Se
  retirará en una migración aparte.
- **Alquileres, terrenos y comercial.** Excluidos por decisión del owner (2026-09-18).
- **Filtros de comprador en `/properties`** (zip, cuartos, precio) y **paginación**. Hoy la
  página es una vitrina sin controles con un tope de 60. Con ~48.500 fichas eso necesita
  filtros y paginación antes de ser usable. Campos verificados contra el feed real:
  `PostalCode` (95 %), `BedroomsTotal`, `BathroomsTotalInteger`, `ListPrice` (100 %),
  `LivingArea`, `YearBuilt`.

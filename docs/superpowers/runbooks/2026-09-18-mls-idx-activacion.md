# Runbook — Activación del feed IDX de MIAMI

**Fecha:** 2026-09-18 · **Estado:** listo para ejecutar, **no ejecutado**
**Dataset:** `miamire` — Miami Association of REALTORS® · acceso **APROBADO** y verificado
**PR:** #129 (adaptador, filtro de cobertura, worker, lectura pública)

---

## Cifras reales del feed, medidas el 2026-09-18

Importan porque definen qué es "normal" en la primera pasada.

| | |
|---|---|
| Fichas totales en el feed | **1.438.500** |
| De las cuales `Closed` (histórico 7 años) | **1.327.107** — el 92 % |
| **Lo que ingerimos** (4 estados públicos, sin filtro de condado) | **~94.000** |
| Tras el filtro de cobertura (Miami-Dade · Broward · Palm Beach) | **~81 %** de lo recibido |
| Modificadas en 24 h | ~17.000 → **~4.250 por pasada de 6 h** |
| Velocidad observada | 200 fichas / ~0,5 s |

**Reparto de condados en 1.000 fichas reales:** Miami-Dade 342 · Palm Beach 333 · Broward
141 · fuera de cobertura 157 · sin condado 27.

---

## Antes de empezar

- [ ] **PR #129 mergeado** a `main`
- [ ] `MLS_BRIDGE_SERVER_TOKEN` en Vercel **Production** (ya está)
- [ ] `MLS_FEED_ENABLED` **NO** puesta todavía — es el último interruptor

---

## Paso 1 · Aplicar la migración

Crea `mls_listings` y `mls_sync_state`. **Requiere sign-off del owner** — convención del
repo: nunca `db push` sin autorización explícita.

```bash
cd /Users/camiloisaza/Code/lixtara
supabase db push --dry-run     # debe listar SOLO 20260916140000_mls_idx_feed
supabase db push
```

Verificar que quedaron con **RLS activo y CERO políticas** (deny-all deliberado: el único
lector es el cliente service-role; si fueran legibles por `anon`, cualquiera podría paginar
el feed entero vía PostgREST — Schedule A §6):

```sql
select tablename, rowsecurity from pg_tables
 where schemaname='public' and tablename in ('mls_listings','mls_sync_state');
-- ambas rowsecurity = true

select tablename, count(*) as policies from pg_policies
 where schemaname='public' and tablename in ('mls_listings','mls_sync_state')
 group by tablename;
-- CERO filas es lo correcto
```

## Paso 2 · Variables en Production

```bash
vercel env add MLS_FEED_ENABLED production      # valor: true
vercel env add MLS_BRIDGE_DATASET production    # valor: miamire
```

⚠️ **Production únicamente.** Ni Preview ni Development: el acuerdo licencia el feed para
`lixtara.com` y nada más (Schedule B §1). El gate lo hace cumplir, pero ponerlas en otro
entorno sigue siendo una mala configuración.

Redeploy para que la ruta las vea.

## Paso 3 · Primera pasada, disparada a mano

**No esperes al cron.** Dispárala tú para poder mirarla.

```bash
curl -s -X POST https://lixtara.com/api/mls/sync \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

### Qué debe devolver

```json
{
  "completed": true,
  "stoppedBy": "completed",
  "pages": 470,
  "received": 94000,
  "upserted": 76000,
  "needsAttention": false
}
```

**Rangos esperados:**

| Campo | Normal | Qué significa si se sale |
|---|---|---|
| `pages` | 400-500 | Muchas menos: el filtro de estado no se aplicó |
| `received` | 90.000-100.000 | ~1,4 M: el filtro de estado NO funcionó — **abortar** |
| `upserted` | ~80 % de `received` | Mucho menos: el filtro de cobertura rechaza de más |
| `completed` | `true` | `false` → ver "Pasada incompleta" abajo |
| `needsAttention` | `false` | `true` → ver el log estructurado |

### Pasada incompleta no es un fallo

Si `completed: false` y `stoppedBy: "time_budget"` o `"max_pages"`, **es el diseño
funcionando**: la pasada guardó dónde quedó y la siguiente invocación continúa ahí. Vuelve
a disparar hasta que dé `completed: true`. El cursor de tiempo no avanza hasta entonces.

Lo que **sí** es un problema: que `resume_cursor` quede null tras una pasada parcial —
significaría que la próxima reempieza desde cero y **no convergería nunca**.

```sql
select dataset, last_run_status, records_seen,
       last_modification_ts,
       (resume_cursor is not null) as tiene_reanudacion,
       left(coalesce(last_error,''), 120) as error
  from public.mls_sync_state;
```

## Paso 4 · Verificar lo ingerido

```sql
-- Reparto por condado. Solo deben aparecer los tres.
select payload->>'CountyOrParish' as condado, count(*)
  from public.mls_listings group by 1 order by 2 desc;

-- Estados. NO debe haber Closed.
select mls_status, count(*) from public.mls_listings group by 1 order by 2 desc;

-- Atribución: obligatoria en toda ficha de tercero (Schedule A §9).
select count(*) filter (where list_office_name is null) as sin_oficina, count(*) as total
  from public.mls_listings;
```

`sin_oficina` > 0 no es un fallo: `listingAttribution` degrada a texto genérico en vez de
omitir la línea, porque **omitirla es el incumplimiento**.

## Paso 5 · Verificar la página pública

```bash
curl -s https://lixtara.com/en/properties | grep -c "courtesy of"   # > 0
curl -s https://lixtara.com/es/properties | grep -c "cortesía de"   # > 0
curl -s https://lixtara.com/en/properties | grep -c "SEFMLS"        # = 1
curl -s https://lixtara.com/en/properties | grep -c "MIAMI REALTORS" # = 1
```

Y el control negativo — **el mismo deployment de producción en un host no licenciado**:

```bash
curl -s https://lixtara.vercel.app/en/properties | grep -c "courtesy of"   # debe ser 0
```

Si ese último **no** es 0, el gate de exhibición no está funcionando: **apagar el flag de
inmediato**, porque estaría sirviendo contenido licenciado desde un sitio que el acuerdo no
nombra.

### Deduplicación

Un listing propio cuyo `mls_number` esté anotado no debe salir dos veces:

```sql
select p.id, p.address_street, p.mls_number
  from public.properties p
  join public.mls_listings m on upper(replace(m.listing_id,' ','')) = upper(replace(p.mls_number,' ',''))
 where p.mls_status = 'active';
```

Cada fila aquí es una supresión que la página debe estar aplicando. **Hoy `mls_number` no
se escribe en ningún sitio del código**, así que lo normal es que devuelva vacío hasta que
Anamaria los anote desde Matrix.

## Paso 6 · Dejar correr el cron

`23 */6 * * *` — cuatro veces al día. El mínimo contractual son 24 h (Schedule A §5).

Tras la primera pasada automática:

```sql
select dataset, last_run_at, last_run_status, records_seen
  from public.mls_sync_state;
```

En régimen, `records_seen` ronda **4.000-5.000** por pasada, no 94.000.

---

## Kill switch

```bash
vercel env rm MLS_FEED_ENABLED production && vercel --prod
```

El gate es fail-closed: sin la variable, la ingesta se detiene y la página pública deja de
mostrar fichas del feed **de inmediato**. Los listings propios no se ven afectados.

Los datos ya ingeridos siguen en la tabla. Para purgarlos —§ VI.C al terminar el acuerdo—
está `docs/superpowers/runbooks/rollback-20260916140000_mls_idx_feed.sql`, con la
advertencia de que `DROP` no alcanza los backups PITR de Supabase.

---

## Qué vigilar la primera semana

| Señal | Dónde | Umbral |
|---|---|---|
| `needsAttention: true` | respuesta del worker y log `mls_sync_run` | cualquiera |
| `county_field_missing` alto | `excluded` en el log | >50 % de `received` |
| Pasadas `partial` encadenadas | `last_run_status` | más de 2 seguidas |
| Fichas retiradas sin salir | comparar `mls_status` contra la página | >24 h es incumplimiento |

El log estructurado del worker es `mls_sync_run` y **nunca lleva una ficha**: solo conteos
y motivos.

---

## Lo que este runbook NO cubre

- **Comparables del vendedor.** Necesitan datos `Closed`, que el worker deliberadamente no
  ingiere: son 1,3 M de fichas, el 92 % del feed. El diseño propuesto es una consulta **bajo
  demanda** —ventas cercanas a una dirección en los últimos N meses— en vez de replicarlas.
  Rentcast sigue en pie hasta entonces.
- **Detección de borrados.** Los cambios de estado llegan por el incremental y `withdrawn_at`
  cubre lo retirado, pero una ficha **eliminada** del feed no se detecta sin una pasada
  completa periódica. Pendiente de decidir.
- **Fotos.** Se decidió hot-link al CDN del MLS, no descargarlas. El worker actual no toca
  `Media`.

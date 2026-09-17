# Diseño — Lector del feed IDX de MIAMI (Bridge API)

**Fecha:** 2026-09-16 · **Estado:** DISEÑO, pendiente de aprobación. Nada implementado.
**Base:** `main@c60cd02` (PR #126 mergeado: gate de entorno ADR-0013 + frontera IA ADR-0014)
**Contrato:** MIAMI AOR Broker 2024 Member Data License Agreement · feed **IDX único**

---

## 0 · Qué ya existe y qué no

| | Estado |
|---|---|
| Gate de entorno (`src/lib/mls/environment-gate.ts`) | ✅ en producción |
| Frontera MLS ⇄ IA (`licensed-content.ts` + guard) | ✅ en producción |
| Cliente de Bridge · tabla `mls_listings` · worker de sync · compliance de display | ❌ **nada** |

Este documento cubre lo que falta.

---

## 1 · La forma de la API de Bridge

⚠️ **Verificado por búsqueda, NO por la documentación oficial** — `bridgedataoutput.com/docs`
es una SPA que no sirve contenido a un fetch. **Todo lo de esta sección debe confirmarse
contra la API real en cuanto existan credenciales.** El diseño está hecho para que esa
confirmación no cambie la arquitectura, solo el adaptador.

```
Base        https://api.bridgedataoutput.com/api/v2/OData/{dataset}/Property
Auth        access_token (query param) y/o Authorization: Bearer
OData 4.0   $filter · $select · $orderby · $top · $count · $expand
Paginación  enlace "next" en la respuesta
On-demand   máximo 200 por página (header maxpagesize, default 10)
Replication endpoint /replication, $top hasta 2.000
```

**Decisión: usar `/replication` para el sync incremental.** 10× la página, y es el endpoint
que Bridge documenta para exactamente este caso. El endpoint OData normal queda para consultas
puntuales.

---

## 2 · Esquema — `mls_listings`, separada de `properties`

**No reutilizar `properties`.** Tres razones, todas bloqueantes:

1. `properties.owner_id` es **NOT NULL con FK a `auth.users`**. Un listing de un tercero no
   tiene dueño en Lixtara. No hay valor legítimo que poner ahí.
2. Sus políticas RLS mezclan `mls_status='active'` con propiedad del vendedor. Meter filas sin
   dueño rompe el dashboard del vendedor y las políticas de `property_photos`.
3. **§VI.C obliga a destruir todo el contenido licenciado —backups incluidos— en 10 días** al
   terminar el acuerdo. Una tabla separada se purga con un `TRUNCATE`; mezclado sería cirugía
   sobre datos propios.

```sql
create table public.mls_listings (
  -- Clave natural del MLS. ListingKey es el identificador estable de RESO.
  listing_key        text primary key,
  listing_id         text not null,              -- el "MLS number" visible
  mls_status         text not null,              -- StandardStatus de RESO
  modification_ts    timestamptz not null,       -- cursor del sync incremental
  -- Payload RESO completo. jsonb y no columnas: el Data Dictionary tiene cientos de
  -- campos, varía por MLS, y proyectar a columnas nos ataría a una versión del schema.
  payload            jsonb not null,
  -- Campos proyectados SOLO para indexar y filtrar. Derivados de payload, nunca
  -- fuente de verdad.
  list_price         numeric(12,2),
  city               text,
  postal_code        text,
  latitude           numeric(10,8),
  longitude          numeric(11,8),
  -- Atribución obligatoria (Schedule A §9). Se guarda porque hay que MOSTRARLA.
  list_office_name   text,
  list_agent_name    text,
  -- Trazabilidad del sync.
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  -- Retiro en 24h (Schedule A). Soft-delete para poder auditar la retirada.
  withdrawn_at       timestamptz
);

create index mls_listings_status_idx  on public.mls_listings (mls_status) where withdrawn_at is null;
create index mls_listings_city_idx    on public.mls_listings (city, postal_code);
create index mls_listings_modts_idx   on public.mls_listings (modification_ts desc);
create index mls_listings_listid_idx  on public.mls_listings (listing_id);

-- RLS deny-all, igual que creative_studio_video_access: el único lector es el
-- cliente service-role del servidor. El contenido licenciado NUNCA se sirve por
-- PostgREST a un navegador — el §III.B.9 prohíbe transmitirlo fuera del Website.
alter table public.mls_listings enable row level security;

-- Cursor del sync, una fila por dataset.
create table public.mls_sync_state (
  dataset            text primary key,
  last_modification_ts timestamptz,
  last_run_at        timestamptz,
  last_run_status    text,
  last_error         text,
  records_seen       bigint not null default 0
);
alter table public.mls_sync_state enable row level security;
```

**Por qué RLS deny-all y no lectura pública:** las páginas son SSR. El servidor lee con
service-role y renderiza. Si la tabla fuera legible por `anon`, cualquiera podría paginar el
feed entero vía PostgREST — que es exactamente *"distribute, provide, or make accessible to
any person or entity"* del Schedule A §6.

---

## 3 · Puerto y adaptador

Mismo patrón que `StoragePort` / `RenderProvider`: interfaz pura, adaptador real, fake en
tests. Así el día que se sume **Stellar MLS** (Tampa/Orlando, que también corre sobre
Matrix/CoreLogic) sea un archivo nuevo y no una reescritura.

```ts
// src/lib/mls/feed-port.ts
export interface MlsFeedPage {
  listings: MlsLicensed<RawResoListing>[];
  /** Cursor opaco del proveedor. null = no hay más. */
  nextCursor: string | null;
}

export interface MlsFeedProvider {
  /** Página de listings modificados DESPUÉS de `since`, orden ascendente por
   *  ModificationTimestamp. El orden importa: es lo que hace el cursor reanudable. */
  fetchModifiedSince(since: Date | null, cursor: string | null): Promise<MlsFeedPage>;
}
```

`BridgeAdapter` implementa esto contra `/replication`. **Devuelve `MlsLicensed<T>`** — la marca
de tipo del ADR-0014 se aplica en el único punto por el que entran los datos, así que todo lo
que salga de ahí queda teñido y no puede llegar a un prompt.

La credencial se obtiene **solo** vía `requireMlsServerToken()`, que ya verifica el gate de
entorno antes de devolverla.

---

## 4 · Worker de sincronización

**Reusar el molde del worker de video**, que lleva meses en producción: Vercel Cron → `GET` con
`Authorization: Bearer $CRON_SECRET` verificado en tiempo constante → claim → presupuesto de
tiempo → resumen pequeño en la respuesta, sin trazas ni secretos.

```
/api/mls/sync   ·  cron: "17 */6 * * *"   (4 veces al día)
```

**Por qué cada 6 horas y no cada 15 minutos:** el contrato exige refrescar **al menos cada 24
horas** (Schedule A §5) — no cada 15 minutos, que fue una nota errónea mía en el análisis
inicial. Cuatro veces al día da margen de sobra y no castiga la cuota de la API. El minuto 17
evita el pico de la hora en punto.

**Algoritmo:**

```
1. assertMlsIngestAllowed()          ← producción + flag, si no: 404 silencioso
2. leer cursor de mls_sync_state
3. while (presupuesto de tiempo):
     página = provider.fetchModifiedSince(cursor)
     upsert por listing_key, last_seen_at = now()
     avanzar cursor al MAX(modification_ts) de la página
4. barrido de retiradas: los ACTIVOS que el feed ya no devuelve → withdrawn_at = now()
5. escribir mls_sync_state (estado, error, conteo)
```

**El paso 4 es obligación contractual**, no higiene: los listings expirados o retirados deben
desaparecer en 24 h. Con un cron cada 6 h el peor caso son 6 h, dentro de plazo.

**Idempotencia:** upsert por `listing_key` (PK). Un reintento no duplica. El cursor solo avanza
tras persistir la página, así que un fallo a medias reprocesa esa página y nada más.

---

## 5 · Deduplicación — la decisión aprobada

El feed IDX **incluye los listings de la propia correduría** (confirmado por MIAMI). Sin
deduplicar, cada propiedad de un vendedor de Lixtara aparece dos veces en `/properties`.

**Clave natural: `properties.mls_number`, que ya tiene constraint UNIQUE** en el baseline.

```
Para cada ficha del feed:
  ¿existe properties.mls_number = listing.listing_id ?
    SÍ  → es NUESTRA. Renderizar desde `properties`; suprimir la copia del feed.
          Es más rica: fotos del vendedor, staging IA, video de Creative Studio.
          Y NO lleva atribución de tercero: la agencia listadora somos nosotros.
    NO  → es de un tercero. Renderizar desde `mls_listings` CON atribución obligatoria.
```

**Efecto secundario valioso:** el cruce es también el mecanismo que **cierra el hueco de
`mls_number`**, que hoy no se escribe en ninguna parte del código. Cuando Anamaria publique un
listing en Matrix, el feed lo devuelve y el cruce lo reconcilia.

🔴 **Pero ese write tiene una pregunta legal abierta.** §III.B.9 prohíbe *"download, distribute,
export, deliver, or transmit any of the Licensed Content ... except Participant's Website"*.
Escribir el `mls_number` en la base interna es **procesamiento**, no exhibición.

**Mitigación de diseño:** en la v1, el cruce es de **solo lectura** — se compara en memoria al
renderizar, sin escribir nada en `properties`. Anamaria anota el `mls_number` a mano desde
Matrix, que es un campo por listing. La reconciliación automática queda detrás de la respuesta
del abogado. **Esto no bloquea nada.**

---

## 6 · Compliance de display

Nada de esto existe hoy. Módulo `src/lib/mls/display-compliance.ts`, aplicado en **toda**
superficie que muestre una ficha ajena.

| Obligación | Fuente | Implementación |
|---|---|---|
| `This listing is courtesy of {firma}` | Schedule A §9 | Tipografía **≥ la mediana** de la ficha, color legible, ubicación prominente. No es letra chica. |
| Campos extra de atribución | Schedule A §9 | Teléfono/email de oficina y agente **si la correduría listadora los marcó** |
| Aviso de copyright SEFMLS | Schedule A §10 | Texto literal, en toda página con contenido licenciado |
| Disclaimer de fiabilidad | Schedule C §2 | *"deemed reliable, but not guaranteed accurate by MIAMI REALTORS®"* |
| Vendedor que retiró permiso | Schedule A §3 | El feed ya los excluye (§II.E.6); no re-exponerlos |
| Prevención activa de scraping | Schedule A §1 | **Obligación activa.** Vercel BotID + rate limit en las rutas públicas de listings |

**Un test debe verificar que la atribución se renderiza**, igual que el guard de la frontera de
IA. Es la obligación más fácil de romper en un refactor de UI y la más visible para el MLS.

---

## 7 · Fotos — decisión pendiente

El feed incluye `Media`. Dos caminos y no son equivalentes:

| | Hot-link al CDN del MLS | Descargar a Supabase Storage |
|---|---|---|
| Coste | $0 | Storage + egress por cada foto de cada listing |
| §VI.C purga en 10 días | Trivial: no hay copias | Hay que borrar objetos, no solo filas |
| §III.B.9 "download" | No aplica | **Es literalmente descargar contenido licenciado** |
| Rendimiento | Depende del CDN ajeno | Control propio |

**Recomendación: hot-link en la v1.** Es más barato, evita la pregunta del §III.B.9 y hace
trivial la purga. Si el CDN resulta lento, se reevalúa con datos.

---

## 8 · Rentcast

Una vez el feed sirva comps, `src/lib/rentcast.ts` se retira y se cancela la suscripción:
**$1.188/año**. No antes de comparar la calidad de los comps con datos reales.

---

## 9 · Orden de construcción

Cada paso deja el sistema verde y es revisable por separado.

| # | Entrega | Depende de |
|---|---|---|
| 1 | Migración `mls_listings` + `mls_sync_state`, RLS deny-all. **Autorizada pero NO aplicada** | — |
| 2 | `feed-port.ts` + fake + tests. Contrato puro, sin red | — |
| 3 | `BridgeAdapter` contra `/replication` | credenciales en Vercel |
| 4 | Worker `/api/mls/sync` + cron, sobre el molde del worker de video | 1-3 |
| 5 | `display-compliance.ts` + tests de atribución | — |
| 6 | Lectura pública con dedup en `/properties` y `/property/[id]` | 1-5 |
| 7 | Migrar comps del paso 3 del wizard; retirar Rentcast | 6 |

**Los pasos 1, 2 y 5 no necesitan credenciales** — se pueden construir y probar ya.

---

## 10 · Decisiones que necesito de ti

1. **¿Fotos hot-link o descargadas?** (recomiendo hot-link)
2. **¿Cada 6 horas está bien?** El mínimo contractual es 24 h.
3. **¿Cobertura geográfica?** El feed trae Miami MLS **y Beaches MLS** (Broward, Palm Beach) más
   listings globales fuera de área. ¿Se muestran todos, o se filtra a los mercados de Lixtara?
   Schedule D §6.j permite excluir por criterios objetivos como geografía.
4. **¿Arranco por los pasos 1, 2 y 5**, que no dependen de las credenciales?

-- Lector del feed IDX de MIAMI — almacenamiento del contenido licenciado y cursor del sync.
-- Diseño: docs/superpowers/plans/2026-09-16-mls-idx-feed-reader-design.md
-- Contrato: MIAMI AOR Broker 2024 Member Data License Agreement (feed IDX único).
--
-- POR QUÉ ESTAS TABLAS SON SEPARADAS DE `properties` — tres razones bloqueantes:
--   1. `properties.owner_id` es NOT NULL con FK a auth.users. Un listing de un tercero no
--      tiene dueño en Lixtara; no hay valor legítimo que poner ahí.
--   2. Las políticas RLS de `properties` mezclan `mls_status='active'` con propiedad del
--      vendedor. Filas sin dueño romperían el dashboard y `property_photos`.
--   3. § VI.C obliga a destruir TODO el contenido licenciado —backups incluidos— dentro de
--      10 días del fin del acuerdo. Separado es un TRUNCATE; mezclado sería cirugía sobre
--      datos propios.
--
-- RLS DENY-ALL (enabled, sin políticas), igual que creative_studio_video_access: el único
-- lector es el cliente service-role del servidor. Las páginas son SSR. Si estas tablas
-- fueran legibles por `anon`, cualquiera podría paginar el feed completo vía PostgREST —
-- exactamente lo que prohíbe el Schedule A §6 ("no portion ... may be distributed,
-- provided, or made accessible to any person or entity").
--
-- Idempotente. AUTORIZADA, NO APLICADA — aplicar solo con sign-off del owner
-- (`supabase db push`). Rollback: docs/superpowers/runbooks/rollback-20260916140000_mls_idx_feed.sql

create table if not exists public.mls_listings (
  -- ListingKey de RESO: identificador estable e inmutable del MLS. Es la PK porque es
  -- por lo que se hace upsert en cada pasada del sync.
  listing_key          text primary key,
  -- ListingId: el "número de MLS" visible, y la clave con la que se cruza contra
  -- properties.mls_number para deduplicar los listings propios.
  listing_id           text not null,
  -- StandardStatus de RESO (Active, Active Under Contract, Pending, Closed, ...).
  mls_status           text not null,
  -- Cursor del sync incremental. El worker pide siempre "modificados después de X"
  -- en orden ascendente, así que este campo es lo que hace el proceso reanudable.
  modification_ts      timestamptz not null,

  -- Payload RESO completo. jsonb y no columnas: el Data Dictionary tiene cientos de
  -- campos, varía entre MLSs, y proyectarlo nos ataría a una versión del esquema.
  payload              jsonb not null,

  -- Campos proyectados SOLO para indexar y filtrar. Derivados de `payload`, que sigue
  -- siendo la fuente de verdad. Si divergen, gana el payload.
  list_price           numeric(12,2),
  city                 text,
  postal_code          text,
  latitude             numeric(10,8),
  longitude            numeric(11,8),

  -- Atribución obligatoria (Schedule A §9). Se persiste porque hay que MOSTRARLA junto
  -- a cada ficha que no sea de nuestra correduría, no por conveniencia de consulta.
  list_office_name     text,
  list_office_phone    text,
  list_office_email    text,
  list_agent_name      text,
  list_agent_phone     text,
  list_agent_email     text,

  -- Trazabilidad del sync.
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),

  -- Retiro en 24h (Schedule A). Soft-delete: se conserva la fila para poder auditar
  -- CUÁNDO se retiró, que es lo que demuestra el cumplimiento del plazo.
  withdrawn_at         timestamptz
);

-- Lectura principal: listings vigentes por estado.
create index if not exists mls_listings_status_idx
  on public.mls_listings (mls_status) where withdrawn_at is null;
-- Búsqueda geográfica de la página pública.
create index if not exists mls_listings_geo_idx
  on public.mls_listings (city, postal_code) where withdrawn_at is null;
-- Barrido del sync y diagnóstico.
create index if not exists mls_listings_modts_idx
  on public.mls_listings (modification_ts desc);
-- Cruce de deduplicación contra properties.mls_number.
create index if not exists mls_listings_listing_id_idx
  on public.mls_listings (listing_id);

alter table public.mls_listings enable row level security;

-- Cursor del sync, una fila por dataset. Separada de la tabla de datos para que el
-- avance del cursor sea una escritura pequeña y atómica, independiente del volumen.
create table if not exists public.mls_sync_state (
  dataset              text primary key,
  -- Se avanza SOLO después de persistir la página. Un fallo a medias reprocesa esa
  -- página y nada más — el upsert por listing_key hace que repetir sea inocuo.
  last_modification_ts timestamptz,
  last_run_at          timestamptz,
  last_run_status      text check (last_run_status in ('ok','partial','failed')),
  -- Cursor de REANUDACIÓN dentro de una pasada. Sin esto una pasada parcial reempieza
  -- desde cero en la siguiente invocación, y con 1,4 M de fichas en el feed de MIAMI eso
  -- no converge nunca: el cron re-descargaría eternamente las mismas primeras páginas.
  -- Se guarda el nextLink OPACO del proveedor y se limpia al completar la pasada.
  resume_cursor        text,
  last_error           text,
  records_seen         bigint not null default 0,
  updated_at           timestamptz not null default now()
);

alter table public.mls_sync_state enable row level security;

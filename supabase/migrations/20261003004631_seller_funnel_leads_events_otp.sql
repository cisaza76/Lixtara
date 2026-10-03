-- Funnel del vendedor — Fase B: lead capturado antes del listing, eventos del funnel y
-- control de intentos del código de verificación por email.
-- Plan: ~/.claude/plans/piped-hopping-bird.md (Fase B). Decisiones del owner 2026-10-02.
--
-- TRES TABLAS, TODAS CON RLS ACTIVA:
--   seller_leads                  — 1 fila por usuario que dejó su email (verificado por código).
--                                   Dueño: SELECT de su propia fila. Admin/broker: todo.
--   funnel_events                 — append-only. Solo admin/broker leen. Nadie escribe por
--                                   PostgREST: el servidor inserta con la secret key.
--   email_verification_challenges — DENY-ALL para usuarios (solo servidor). Admin/broker leen.
--
-- ESCRITURAS: ninguna tabla tiene políticas INSERT/UPDATE/DELETE para `authenticated` o
-- `anon`. Todo lo escribe el servidor (route handlers / server actions) con
-- SUPABASE_SECRET_KEY, que salta RLS. Un usuario no puede falsear su atribución, su paso
-- del funnel ni su contador de intentos.
--
-- PII:
--   * `email` vive SOLO en seller_leads (y en auth.users). Nunca en funnel_events.
--   * La atribución (first_touch / last_touch) acepta SOLO claves en lista blanca
--     (utm_*, gclid, fbclid, referrer_host, landing_path, captured_at) — CHECK abajo.
--     referrer_host es solo el host (sin path/query); landing_path es solo el path.
--   * funnel_events.metadata rechaza cualquier valor con forma de email y está limitado
--     en tamaño. Si en el futuro se reenvían eventos a un Pixel (Meta/Google/TikTok),
--     se reenvía este mismo shape: event + step + ids opacos. Sin email, teléfono,
--     nombre ni dirección (ni hasheados) — decisión del owner.
--
-- CÓDIGO DE VERIFICACIÓN — LO VALIDA ESTA TABLA, NO EL OTP DE SUPABASE (decisión 2026-10-02):
--   Un solo validador. El servidor genera el código (6 dígitos, CSPRNG), guarda SOLO su
--   HMAC-SHA256 (clave: env EMAIL_CODE_PEPPER, server-only; mensaje: challenge id + código)
--   y lo envía por Resend. Para verificar, en UNA sentencia atómica:
--       update email_verification_challenges
--          set attempts = attempts + 1
--        where id = $1 and status = 'pending'
--          and attempts < max_attempts and expires_at > now()
--       returning attempts, code_hmac;
--   Sin fila → vencido o bloqueado → hay que pedir otro código. Con fila, se compara el
--   HMAC en tiempo constante; si coincide → status='verified', y recién entonces el
--   servidor llama auth.admin.updateUserById(uid, { email, email_confirm: true }) con la
--   secret key. Eso confirma la posesión del email de ESTE usuario; no activa el
--   auto-confirm global (que sigue apagado: la verificación sigue siendo obligatoria).
--   CONSECUENCIA: los ajustes de Supabase Auth "Email OTP expiration" / "OTP length" /
--   rate limit de /verify NO aplican a este flujo — no se usa signInWithOtp ni verifyOtp.
--   (Siguen aplicando al gate de cuenta del paso 7 mientras exista.)
--   Reenvíos: máx. 3 por hora por usuario (conteo sobre sent_at) + apiLimiter existente.
--
-- CAN-SPAM: email_opt_out_at + unsubscribe_token_hash (sha-256; el token en claro solo
-- viaja en el link del email). La dirección postal física del footer es config de app,
-- no de DB.
--
-- Idempotente. NO APLICADA — aplicar solo con sign-off explícito del owner (`supabase db push`).

-- ---------------------------------------------------------------------------
-- 1. seller_leads
-- ---------------------------------------------------------------------------
-- AL BORRAR EL USUARIO: la fila se borra en cascada (contiene el email). Igual para
-- email_verification_challenges. Solo funnel_events sobrevive, anonimizado (sección 2).
create table if not exists public.seller_leads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 320),
  locale text not null default 'en' check (locale in ('en', 'es')),
  property_id uuid references public.properties(id) on delete set null,
  status text not null default 'email_captured'
    check (status in ('email_captured', 'in_progress', 'submitted', 'published', 'closed')),
  current_step smallint check (current_step between 1 and 8),
  last_step_at timestamptz,
  first_touch jsonb not null default '{}'::jsonb,
  last_touch jsonb not null default '{}'::jsonb,
  email_opt_out_at timestamptz,
  unsubscribe_token_hash text unique check (unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Atribución: objeto con SOLO claves en lista blanca (jsonb - text[] quita esas claves;
  -- si queda algo, había una clave no permitida).
  constraint seller_leads_first_touch_allowlist check (
    jsonb_typeof(first_touch) = 'object'
    and first_touch - array['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                            'gclid','fbclid','referrer_host','landing_path','captured_at']
        = '{}'::jsonb
    and pg_column_size(first_touch) <= 2048
  ),
  constraint seller_leads_last_touch_allowlist check (
    jsonb_typeof(last_touch) = 'object'
    and last_touch - array['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                           'gclid','fbclid','referrer_host','landing_path','captured_at']
        = '{}'::jsonb
    and pg_column_size(last_touch) <= 2048
  )
);

create index if not exists seller_leads_status_step_idx
  on public.seller_leads (status, current_step, last_step_at);
create index if not exists seller_leads_email_idx on public.seller_leads (email);

drop trigger if exists update_seller_leads_updated_at on public.seller_leads;
create trigger update_seller_leads_updated_at
  before update on public.seller_leads
  for each row execute function public.update_updated_at_column();

alter table public.seller_leads enable row level security;

drop policy if exists "seller leads own read" on public.seller_leads;
create policy "seller leads own read" on public.seller_leads for select
  using (auth.uid() = user_id);

drop policy if exists "seller leads admin" on public.seller_leads;
create policy "seller leads admin" on public.seller_leads for all
  using (public.is_admin_or_broker()) with check (public.is_admin_or_broker());

-- ---------------------------------------------------------------------------
-- 2. funnel_events (append-only)
--
-- AL BORRAR EL USUARIO: las filas NO se borran — se anonimizan. La FK pone
-- user_id = NULL y el trigger de abajo limpia también session_id (cookie aleatoria,
-- sin PII, pero es lo único que podría re-asociar eventos de una misma visita).
-- Quedan event/step/property_id/metadata/created_at para las métricas del funnel.
--
-- RETENCIÓN: 24 meses. public.prune_seller_funnel_data() borra eventos con más de
-- 24 meses (y challenges con más de 30 días). Solo la ejecuta el servidor/cron con la
-- secret key; se agenda en la Fase C junto con el cron del drip.
-- ---------------------------------------------------------------------------
create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid,
  property_id uuid references public.properties(id) on delete set null,
  event text not null check (event ~ '^[a-z][a-z0-9_]{2,63}$'),
  step smallint check (step between 0 and 8),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint funnel_events_metadata_shape check (
    jsonb_typeof(metadata) = 'object'
    and pg_column_size(metadata) <= 1024
    -- defensa en profundidad: nada con forma de email en metadata
    and metadata::text !~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
  )
);

create index if not exists funnel_events_user_created_idx
  on public.funnel_events (user_id, created_at desc);
create index if not exists funnel_events_event_created_idx
  on public.funnel_events (event, created_at desc);

alter table public.funnel_events enable row level security;

drop policy if exists "funnel events admin read" on public.funnel_events;
create policy "funnel events admin read" on public.funnel_events for select
  using (public.is_admin_or_broker());

-- Append-only también para admin vía PostgREST: sin políticas UPDATE/DELETE, y sin
-- privilegios de tabla para los roles de API.
revoke update, delete on public.funnel_events from anon, authenticated;

-- Anonimización completa: cuando la FK pone user_id en NULL (usuario borrado), borrar
-- también session_id. Corre dentro de la acción referencial, no depende de la app.
create or replace function public.funnel_events_anonymize_on_user_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.user_id is not null and new.user_id is null then
    new.session_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists funnel_events_anonymize on public.funnel_events;
create trigger funnel_events_anonymize
  before update of user_id on public.funnel_events
  for each row execute function public.funnel_events_anonymize_on_user_delete();

-- ---------------------------------------------------------------------------
-- 3. email_verification_challenges (expiración + límite de intentos del código)
-- ---------------------------------------------------------------------------
create table if not exists public.email_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 320),
  purpose text not null default 'listing_gate' check (purpose in ('listing_gate', 'sign_in')),
  -- HMAC-SHA256 hex del código; el código en claro nunca se guarda.
  code_hmac text not null check (code_hmac ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'locked', 'superseded')),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 10),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  verified_at timestamptz,
  constraint evc_attempts_cap check (attempts <= max_attempts),
  constraint evc_expiry_window check (
    expires_at > sent_at and expires_at <= sent_at + interval '15 minutes'
  )
);

-- Un solo código vivo por usuario: al reenviar, el anterior pasa a 'superseded'.
create unique index if not exists evc_one_pending_per_user
  on public.email_verification_challenges (user_id) where status = 'pending';
create index if not exists evc_user_sent_idx
  on public.email_verification_challenges (user_id, sent_at desc);

alter table public.email_verification_challenges enable row level security;

drop policy if exists "evc admin read" on public.email_verification_challenges;
create policy "evc admin read" on public.email_verification_challenges for select
  using (public.is_admin_or_broker());
-- Sin políticas para el usuario: deny-all. Solo el servidor (secret key) lee/escribe.

-- ---------------------------------------------------------------------------
-- 4. Retención (24 meses para eventos; 30 días para challenges cerrados o vencidos)
-- ---------------------------------------------------------------------------
create or replace function public.prune_seller_funnel_data()
returns table (events_deleted bigint, challenges_deleted bigint)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ev bigint;
  ch bigint;
begin
  delete from public.funnel_events where created_at < now() - interval '24 months';
  get diagnostics ev = row_count;
  delete from public.email_verification_challenges
   where sent_at < now() - interval '30 days';
  get diagnostics ch = row_count;
  return query select ev, ch;
end;
$$;

-- Solo el servidor (service_role / secret key). Nunca invocable vía API pública.
revoke all on function public.prune_seller_funnel_data() from public, anon, authenticated;

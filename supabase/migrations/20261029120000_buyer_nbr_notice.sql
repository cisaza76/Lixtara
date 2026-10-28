-- Aviso NBR (No Brokerage Relationship, F.S. 475.278(4)) para compradores sin agente.
-- Decisión de la broker (2026-10-28): un comprador sin agente se atiende como No Brokerage
-- Relationship. Antes de confirmar la visita tiene que aceptar el aviso; la base lo exige.
--
-- QUÉ CAMBIA
--   1. buyer_leads: nombre y licencia del agente del comprador (cuando tiene agente).
--   2. schedule_requests: si el comprador tiene agente y, si lo tiene, nombre y licencia
--      (visitas pedidas por Loui).
--   3. buyer_nbr_notices: el aviso enviado / aceptado, con la evidencia (nombre, correo,
--      teléfono, listado, versión del texto y su hash, fecha y hora, IP y user agent). Una
--      fila por aviso; la de un lead (formulario o admin) o la de una solicitud de Loui.
--      Aceptada, la evidencia no cambia ni se borra (trigger).
--   4. Reglas en la base:
--      - buyer_leads → showing_confirmed / completed: con agente, su nombre y licencia; sin
--        agente o sin saberlo, un aviso NBR aceptado.
--      - schedule_requests de tipo showing → scheduled / completed: lo mismo. Y el propio
--        comprador (authenticated sin rol de staff) ya no puede marcar su solicitud como
--        programada o completada: solo cancelarla.
--
-- SEGURIDAD
--   - buyer_nbr_notices: RLS activa; solo staff (is_admin_or_broker) lee. Sin políticas de
--     escritura: la escriben las rutas del servidor con la clave secreta.
--   - Ninguna superficie de IA lee esta tabla (Loui solo crea el aviso pendiente).
--
-- SIN `$$` NI CORCHETES a propósito: el owner aplica esto pegándolo en el SQL Editor.
-- Idempotente. Aplicar SOLO con sign-off del owner, ANTES de desplegar el código.

-- ── 1 · Agente del comprador ─────────────────────────────────────────────────────────
alter table public.buyer_leads
  add column if not exists buyer_agent_name text,
  add column if not exists buyer_agent_license text;

alter table public.buyer_leads drop constraint if exists buyer_leads_buyer_agent_len;
alter table public.buyer_leads add constraint buyer_leads_buyer_agent_len check (
  (buyer_agent_name is null or char_length(buyer_agent_name) <= 120)
  and (buyer_agent_license is null or char_length(buyer_agent_license) <= 40)
);

alter table public.schedule_requests
  add column if not exists buyer_agent_status text,
  add column if not exists buyer_agent_name text,
  add column if not exists buyer_agent_license text;

alter table public.schedule_requests drop constraint if exists schedule_requests_buyer_agent_check;
alter table public.schedule_requests add constraint schedule_requests_buyer_agent_check check (
  (buyer_agent_status is null or buyer_agent_status in ('exclusive', 'non_exclusive', 'none', 'unsure'))
  and (buyer_agent_name is null or char_length(buyer_agent_name) <= 120)
  and (buyer_agent_license is null or char_length(buyer_agent_license) <= 40)
);

-- ── 2 · Avisos NBR ───────────────────────────────────────────────────────────────────
create table if not exists public.buyer_nbr_notices (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.buyer_leads(id) on delete restrict,
  schedule_request_id uuid references public.schedule_requests(id) on delete restrict,
  -- Versión del texto (src/lib/nbr-notice.ts). Mientras diga "pending-legal-review", el
  -- texto no tiene la revisión del abogado.
  notice_version text not null,
  -- Enlace para aceptar (avisos que manda el admin o Loui): solo el hash SHA-256 del token.
  token_hash text unique,
  sent_at timestamptz,
  expires_at timestamptz,
  -- Evidencia de la aceptación.
  accepted_at timestamptz,
  full_name text,
  email text,
  phone text,
  listing_label text,
  property_id uuid references public.properties(id) on delete set null,
  listing_key text,
  lang text check (lang is null or lang in ('en', 'es')),
  ip text,
  user_agent text,
  notice_text_sha256 text,
  pdf_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint buyer_nbr_notices_one_subject check (
    (lead_id is not null)::int + (schedule_request_id is not null)::int = 1
  ),
  constraint buyer_nbr_notices_accepted_evidence check (
    accepted_at is null
    or (full_name is not null and email is not null and lang is not null
        and ip is not null and user_agent is not null and notice_text_sha256 is not null)
  ),
  constraint buyer_nbr_notices_lengths check (
    (full_name is null or char_length(full_name) <= 120)
    and (email is null or char_length(email) <= 200)
    and (phone is null or char_length(phone) <= 25)
    and (listing_label is null or char_length(listing_label) <= 300)
    and (user_agent is null or char_length(user_agent) <= 500)
    and (ip is null or char_length(ip) <= 64)
  )
);

create index if not exists buyer_nbr_notices_lead_idx on public.buyer_nbr_notices (lead_id);
create index if not exists buyer_nbr_notices_schedule_idx on public.buyer_nbr_notices (schedule_request_id);

alter table public.buyer_nbr_notices enable row level security;

drop policy if exists "buyer nbr notices staff read" on public.buyer_nbr_notices;
create policy "buyer nbr notices staff read" on public.buyer_nbr_notices for select
  using (public.is_admin_or_broker());

-- La evidencia aceptada no cambia ni se borra. Solo se puede anotar el envío del PDF.
create or replace function public.guard_buyer_nbr_notices()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as '
begin
  if tg_op = ''DELETE'' then
    if old.accepted_at is not null then
      raise exception ''An accepted NBR notice cannot be deleted.'' using errcode = ''42501'';
    end if;
    return old;
  end if;
  if old.accepted_at is not null and (
       new.accepted_at is distinct from old.accepted_at
       or new.full_name is distinct from old.full_name
       or new.email is distinct from old.email
       or new.phone is distinct from old.phone
       or new.listing_label is distinct from old.listing_label
       or new.lang is distinct from old.lang
       or new.ip is distinct from old.ip
       or new.user_agent is distinct from old.user_agent
       or new.notice_version is distinct from old.notice_version
       or new.notice_text_sha256 is distinct from old.notice_text_sha256
       or new.lead_id is distinct from old.lead_id
       or new.schedule_request_id is distinct from old.schedule_request_id) then
    raise exception ''An accepted NBR notice cannot be changed.'' using errcode = ''42501'';
  end if;
  return new;
end;
';

revoke all on function public.guard_buyer_nbr_notices() from public, anon, authenticated;

drop trigger if exists guard_buyer_nbr_notices on public.buyer_nbr_notices;
create trigger guard_buyer_nbr_notices
  before update or delete on public.buyer_nbr_notices
  for each row execute function public.guard_buyer_nbr_notices();

-- ── 3 · Sin aviso aceptado no hay visita confirmada ──────────────────────────────────
-- El trigger corre como quien escribe (current_user = authenticated para la UI, para poder
-- distinguir al comprador del staff). La lectura de los avisos va en un helper SECURITY
-- DEFINER, porque quien escribe no siempre puede leer buyer_nbr_notices.
create or replace function public.nbr_notice_accepted(p_lead uuid, p_schedule uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as '
  select exists (
    select 1 from public.buyer_nbr_notices n
     where n.accepted_at is not null
       and ((p_lead is not null and n.lead_id = p_lead)
            or (p_schedule is not null and n.schedule_request_id = p_schedule))
  );
';

revoke all on function public.nbr_notice_accepted(uuid, uuid) from public, anon;
grant execute on function public.nbr_notice_accepted(uuid, uuid) to authenticated;

create or replace function public.guard_showing_nbr()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as '
declare
  agent_status text;
  agent_name text;
  agent_license text;
  accepted boolean;
begin
  if tg_table_name = ''buyer_leads'' then
    if new.status not in (''showing_confirmed'', ''completed'')
       or (tg_op = ''UPDATE'' and new.status is not distinct from old.status) then
      return new;
    end if;
    agent_status := new.other_agent_status;
    agent_name := new.buyer_agent_name;
    agent_license := new.buyer_agent_license;
    accepted := public.nbr_notice_accepted(new.id, null);
  else
    if new.request_type <> ''showing'' then
      return new;
    end if;
    -- El comprador no confirma su propia visita: solo la puede cancelar.
    if current_user in (''authenticated'', ''anon'') and not public.is_admin_or_broker()
       and new.status in (''scheduled'', ''completed'')
       and (tg_op = ''INSERT'' or new.status is distinct from old.status) then
      raise exception ''Only staff can schedule a showing.'' using errcode = ''42501'';
    end if;
    if new.status not in (''scheduled'', ''completed'')
       or (tg_op = ''UPDATE'' and new.status is not distinct from old.status) then
      return new;
    end if;
    agent_status := new.buyer_agent_status;
    agent_name := new.buyer_agent_name;
    agent_license := new.buyer_agent_license;
    accepted := public.nbr_notice_accepted(null, new.id);
  end if;

  if agent_status in (''exclusive'', ''non_exclusive'') then
    if coalesce(btrim(agent_name), ) =  or coalesce(btrim(agent_license), ) =  then
      raise exception ''nbr_buyer_agent_missing: record the buyer agent name and license before confirming the showing.''
        using errcode = ''23514'';
    end if;
  elsif not accepted then
    raise exception ''nbr_notice_missing: the buyer must accept the No Brokerage Relationship notice before the showing is confirmed.''
      using errcode = ''23514'';
  end if;
  return new;
end;
';

revoke all on function public.guard_showing_nbr() from public, anon, authenticated;

drop trigger if exists guard_showing_nbr on public.buyer_leads;
create trigger guard_showing_nbr
  before insert or update on public.buyer_leads
  for each row execute function public.guard_showing_nbr();

drop trigger if exists guard_showing_nbr on public.schedule_requests;
create trigger guard_showing_nbr
  before insert or update on public.schedule_requests
  for each row execute function public.guard_showing_nbr();

-- ── ROLLBACK (pegar en el SQL Editor si hay que revertir) ───────────────────────────
-- drop trigger if exists guard_showing_nbr on public.schedule_requests;
-- drop trigger if exists guard_showing_nbr on public.buyer_leads;
-- drop function if exists public.guard_showing_nbr();
-- drop function if exists public.nbr_notice_accepted(uuid, uuid);
-- drop trigger if exists guard_buyer_nbr_notices on public.buyer_nbr_notices;
-- drop function if exists public.guard_buyer_nbr_notices();
-- drop table if exists public.buyer_nbr_notices;   -- ¡borra la evidencia! exportarla antes
-- alter table public.schedule_requests drop constraint if exists schedule_requests_buyer_agent_check;
-- alter table public.schedule_requests drop column if exists buyer_agent_license,
--   drop column if exists buyer_agent_name, drop column if exists buyer_agent_status;
-- alter table public.buyer_leads drop constraint if exists buyer_leads_buyer_agent_len;
-- alter table public.buyer_leads drop column if exists buyer_agent_license,
--   drop column if exists buyer_agent_name;

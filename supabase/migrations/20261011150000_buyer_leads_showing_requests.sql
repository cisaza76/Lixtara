-- Buyer leads, fase 1: solicitudes de visita atendidas por una Realtor real.
-- Plan: docs/planning/2026-10-compradores/ (00-plan-maestro § 10–11, 04-roadmap M3).
--
-- QUÉ CAMBIA
--   1. `buyer_leads.status` pasa a los 9 estados del embudo (antes: new/contacted/
--      qualified/assigned/closed/lost; las filas existentes se reasignan).
--   2. Columnas de la solicitud: origen, ficha de interés (listing_key del feed IDX o
--      property_id propio), franjas, mensaje, declaración de acuerdo con otro broker,
--      "necesita vender primero", idioma, consentimientos con fecha y versión del texto.
--   3. Registro contractual (`agreement_*`) y REGLA DURA en la base: los estados
--      agreement_signed / showing_confirmed / completed exigen un acuerdo registrado, o
--      `not_required` con motivo escrito. No es solo la UI: la base rechaza la escritura.
--   4. `handled_by_agent_id`: quién atiende, distinto de quién lo recibió (assigned).
--   5. `agent_partners` se reutiliza como roster de responsables, con su relación
--      (broker_of_record / internal_associate / referral_partner) y su brokerage, que no
--      tiene por qué ser Lixtara. La fila de la broker de registro la crea el código desde
--      src/config/brokerage.ts (única fuente del nombre y la licencia).
--   6. `buyer_lead_events`: historial de creación, estados, asignaciones y acuerdo,
--      escrito SOLO por trigger (nadie puede insertarlo ni editarlo desde la API).
--
-- SEGURIDAD
--   - buyer_leads conserva su RLS: staff (is_admin_or_broker) todo; el comprador con
--     cuenta solo ve las suyas. NO hay política de INSERT pública: la solicitud entra por
--     una ruta de servidor con la clave secreta, detrás de un interruptor fail-closed.
--   - Se elimina la política "agents read active" de agent_partners: ningún código la
--     usaba y exponía nombre, email y teléfono de los agentes a cualquier usuario con
--     sesión.
--   - Ninguna de estas tablas puede llegar a un modelo de IA (contienen listing_key del
--     feed; ver src/lib/mls/ai-boundary.test.ts).
--
-- SIN `$$` NI CORCHETES a propósito: el owner aplica esto pegándolo en el SQL Editor y ese
-- formato llegó alterado al copiarlo desde el chat (2026-10-11). Cuerpos entre comillas
-- simples, con las internas dobladas.
--
-- Las filas 'closed' históricas se migran a 'completed' con acuerdo `not_required` y motivo
-- "legacy", así la regla de acuerdo valida sobre todas las filas.
--
-- Idempotente. Aplicar SOLO con sign-off del owner.

-- ── 1 · Solicitud, consentimientos, responsables y acuerdo ───────────────────────────
alter table public.buyer_leads
  add column if not exists source text not null default 'manual',
  add column if not exists listing_key text,
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists preferred_times text,
  add column if not exists message text,
  add column if not exists other_agent_status text,
  add column if not exists needs_to_sell text,
  add column if not exists lang text,
  add column if not exists consent_contact_at timestamptz,
  add column if not exists consent_marketing_at timestamptz,
  add column if not exists consent_version text,
  add column if not exists handled_by_agent_id uuid references public.agent_partners(id) on delete set null,
  add column if not exists agreement_type text,
  add column if not exists agreement_recorded_at timestamptz,
  add column if not exists agreement_reference text,
  add column if not exists agreement_exception_reason text,
  add column if not exists cancel_reason text;

alter table public.buyer_leads drop constraint if exists buyer_leads_source_check;
alter table public.buyer_leads add constraint buyer_leads_source_check
  check (source in ('showing_request', 'loui', 'contact_form', 'manual'));

alter table public.buyer_leads drop constraint if exists buyer_leads_other_agent_check;
alter table public.buyer_leads add constraint buyer_leads_other_agent_check
  check (other_agent_status is null
         or other_agent_status in ('exclusive', 'non_exclusive', 'none', 'unsure'));

alter table public.buyer_leads drop constraint if exists buyer_leads_needs_to_sell_check;
alter table public.buyer_leads add constraint buyer_leads_needs_to_sell_check
  check (needs_to_sell is null or needs_to_sell in ('yes', 'no', 'maybe'));

alter table public.buyer_leads drop constraint if exists buyer_leads_lang_check;
alter table public.buyer_leads add constraint buyer_leads_lang_check
  check (lang is null or lang in ('en', 'es'));

alter table public.buyer_leads drop constraint if exists buyer_leads_agreement_type_check;
alter table public.buyer_leads add constraint buyer_leads_agreement_type_check
  check (agreement_type is null or agreement_type in
         ('showing_agreement', 'exclusive_buyer_brokerage', 'other_written', 'not_required'));

-- ── 2 · Estados ──────────────────────────────────────────────────────────────────────
alter table public.buyer_leads drop constraint if exists buyer_leads_status_check;

-- Las 'closed' históricas pasan a 'completed' marcadas como legado, para que la regla de
-- acuerdo (abajo) valide sobre TODAS las filas y esas filas sigan siendo editables.
update public.buyer_leads set
    agreement_type = 'not_required',
    agreement_recorded_at = coalesce(agreement_recorded_at, now()),
    agreement_exception_reason = 'Legacy lead, closed before the 2026-10 pipeline'
  where status = 'closed' and agreement_type is null;

update public.buyer_leads set status = case status
    when 'new' then 'received'
    when 'qualified' then 'contacted'
    when 'assigned' then 'contact_pending'
    when 'closed' then 'completed'
    when 'lost' then 'cancelled'
    else status end
  where status in ('new', 'qualified', 'assigned', 'closed', 'lost');

alter table public.buyer_leads alter column status set default 'received';

alter table public.buyer_leads add constraint buyer_leads_status_check check (status in (
  'received', 'contact_pending', 'contacted', 'agreement_pending', 'agreement_signed',
  'showing_coordinating', 'showing_confirmed', 'completed', 'cancelled'));

-- Una solicitud de visita siempre trae el consentimiento de contacto.
alter table public.buyer_leads drop constraint if exists buyer_leads_showing_consent_check;
alter table public.buyer_leads add constraint buyer_leads_showing_consent_check
  check (source <> 'showing_request' or consent_contact_at is not null);

-- REGLA DURA: no hay acuerdo firmado, visita confirmada ni visita completada sin el
-- cumplimiento contractual registrado.
alter table public.buyer_leads drop constraint if exists buyer_leads_agreement_before_showing;
alter table public.buyer_leads add constraint buyer_leads_agreement_before_showing check (
  status not in ('agreement_signed', 'showing_confirmed', 'completed')
  or (
    agreement_recorded_at is not null
    and agreement_type is not null
    and (agreement_type <> 'not_required'
         or length(btrim(coalesce(agreement_exception_reason, ''))) > 0)
  )
);

create index if not exists buyer_leads_created_idx on public.buyer_leads (created_at desc);

-- ── 3 · Roster de responsables (reutiliza agent_partners) ────────────────────────────
alter table public.agent_partners
  add column if not exists relationship text not null default 'referral_partner',
  add column if not exists brokerage_name text,
  add column if not exists brokerage_license text;

alter table public.agent_partners drop constraint if exists agent_partners_relationship_check;
alter table public.agent_partners add constraint agent_partners_relationship_check
  check (relationship in ('broker_of_record', 'internal_associate', 'referral_partner'));

-- Una sola broker de registro.
create unique index if not exists agent_partners_one_broker_of_record
  on public.agent_partners (relationship) where relationship = 'broker_of_record';

drop policy if exists "agents read active" on public.agent_partners;

-- ── 4 · Historial ───────────────────────────────────────────────────────────────────
create table if not exists public.buyer_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.buyer_leads(id) on delete cascade,
  -- auth.uid() de quien hizo el cambio; null = la ruta pública o un proceso de servidor.
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in
    ('created', 'status_changed', 'assigned', 'handler_changed', 'agreement_recorded')),
  from_value text,
  to_value text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists buyer_lead_events_lead_idx
  on public.buyer_lead_events (lead_id, created_at);

alter table public.buyer_lead_events enable row level security;

drop policy if exists "buyer lead events staff read" on public.buyer_lead_events;
create policy "buyer lead events staff read" on public.buyer_lead_events for select
  using (public.is_admin_or_broker());
-- Sin políticas de INSERT/UPDATE/DELETE: solo el trigger (SECURITY DEFINER) escribe.

create or replace function public.buyer_lead_events_log()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as '
begin
  if tg_op = ''INSERT'' then
    insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, to_value, note)
      values (new.id, auth.uid(), ''created'', new.status, new.source);
    if new.assigned_agent_id is not null then
      insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, to_value)
        values (new.id, auth.uid(), ''assigned'', new.assigned_agent_id::text);
    end if;
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, from_value, to_value, note)
      values (new.id, auth.uid(), ''status_changed'', old.status, new.status,
              case when new.status = ''cancelled'' then new.cancel_reason end);
  end if;
  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, from_value, to_value)
      values (new.id, auth.uid(), ''assigned'', old.assigned_agent_id::text, new.assigned_agent_id::text);
  end if;
  if new.handled_by_agent_id is distinct from old.handled_by_agent_id then
    insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, from_value, to_value)
      values (new.id, auth.uid(), ''handler_changed'', old.handled_by_agent_id::text, new.handled_by_agent_id::text);
  end if;
  if new.agreement_type is distinct from old.agreement_type
     or new.agreement_recorded_at is distinct from old.agreement_recorded_at then
    insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, from_value, to_value, note)
      values (new.id, auth.uid(), ''agreement_recorded'', old.agreement_type, new.agreement_type,
              coalesce(new.agreement_reference, new.agreement_exception_reason));
  end if;
  return null;
end;
';

revoke all on function public.buyer_lead_events_log() from public, anon, authenticated;

drop trigger if exists buyer_lead_events_log on public.buyer_leads;
create trigger buyer_lead_events_log
  after insert or update on public.buyer_leads
  for each row execute function public.buyer_lead_events_log();

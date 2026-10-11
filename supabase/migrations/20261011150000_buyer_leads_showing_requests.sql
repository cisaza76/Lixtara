-- Buyer leads, fase 1: solicitudes de visita atendidas por una Realtor real.
-- Plan: docs/planning/2026-10-compradores/ (00-plan-maestro § 10–11, 04-roadmap M3).
-- Despliegue y rollback: docs/superpowers/runbooks/2026-10-11-buyer-leads-fase1-despliegue.md
--
-- QUÉ CAMBIA
--   1. `buyer_leads.status` adopta los 9 estados del embudo para los leads NUEVOS.
--   2. FILAS HISTÓRICAS: NO se transforman. El embudo de mayo de 2026 (commit d5f9865) era
--      new → contacted → qualified → assigned (a un agente aliado) → closed / lost, y
--      `closed` significaba OPERACIÓN CERRADA, no visita completada. Mapearlo a otro estado
--      cambiaría su significado. Se marcan `source = 'legacy'`, se copia su estado a
--      `legacy_status` y CONSERVAN su estado original. La broker las reclasifica una a una,
--      si quiere, desde /admin/buyer-leads. No hay conversión automática.
--   3. Columnas de la solicitud: origen, ficha de interés (listing_key del feed IDX o
--      property_id propio), franjas, mensaje, acuerdo con otro broker, "necesita vender
--      primero", idioma, consentimientos con fecha y versión del texto.
--   4. Registro contractual (`agreement_*`) con REGLAS DURAS en la base:
--      - agreement_signed / showing_confirmed / completed exigen un acuerdo registrado.
--      - `not_required` solo con un MOTIVO DE CATÁLOGO (no texto libre), y solo en
--        listings PROPIOS de Lixtara. En fichas de otros brokers siempre hace falta acuerdo.
--      - agreement_signed no admite `not_required`.
--      - Registrar o cambiar el acuerdo: solo el rol `broker` (la licenciada), no `admin`.
--   5. `handled_by_agent_id`: quién atiende, distinto de quién lo recibió (assigned).
--   6. `agent_partners` como roster de responsables: relación (broker_of_record /
--      internal_associate / referral_partner) y brokerage. Estar en el roster NO da acceso
--      a nada: no es una cuenta. La fila de la broker la crea el código desde
--      src/config/brokerage.ts.
--   7. `buyer_lead_events`: historial escrito SOLO por trigger.
--
-- SEGURIDAD
--   - buyer_leads: solo staff (is_admin_or_broker). Se elimina "buyer leads own": ningún
--     código la usaba y dejaría al comprador leer notas internas de la broker y el
--     registro contractual. No hay política de INSERT pública: la solicitud entra por una
--     ruta de servidor con la clave secreta, detrás de un interruptor fail-closed.
--   - agent_partners: se elimina "agents read active" (exponía nombre, email y teléfono
--     de los agentes a cualquier usuario con sesión; ningún código la usaba).
--   - Ninguna de estas tablas puede llegar a un modelo de IA (ai-boundary.test.ts).
--
-- Catálogo de excepciones `not_required` (PENDIENTE DEL ABOGADO; ampliar solo con su
-- aprobación, aquí y en src/lib/buyer-leads.ts):
--   open_house_seller_side         · open house de un listing propio, atendido por cuenta
--                                    del vendedor (NAR: no exige acuerdo con el comprador).
--   unrepresented_buyer_own_listing · comprador no representado en un listing propio;
--                                    Lixtara actúa solo por el vendedor (escenario B4).
--
-- SIN `$$` NI CORCHETES a propósito: el owner aplica esto pegándolo en el SQL Editor.
-- Cuerpos entre comillas simples, con las internas dobladas.
--
-- Idempotente. Aplicar SOLO con sign-off del owner.

-- ── 1 · Columnas ────────────────────────────────────────────────────────────────────
alter table public.buyer_leads
  add column if not exists source text not null default 'manual',
  add column if not exists legacy_status text,
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
  add column if not exists agreement_exception_code text,
  add column if not exists agreement_note text,
  add column if not exists cancel_reason text;

-- ── 2 · Filas históricas: se preservan ───────────────────────────────────────────────
-- Toda fila anterior a esta migración es del embudo de mayo de 2026. Se marca, se copia su
-- estado y NO se toca el estado. Correr dos veces no hace nada (legacy_status ya está).
update public.buyer_leads
   set source = 'legacy', legacy_status = status
 where legacy_status is null
   and source = 'manual'
   and consent_contact_at is null
   and created_at < now();

alter table public.buyer_leads alter column status set default 'received';

alter table public.buyer_leads drop constraint if exists buyer_leads_status_check;
alter table public.buyer_leads add constraint buyer_leads_status_check check (
  status in ('received', 'contact_pending', 'contacted', 'agreement_pending',
             'agreement_signed', 'showing_coordinating', 'showing_confirmed',
             'completed', 'cancelled')
  or (source = 'legacy'
      and status in ('new', 'contacted', 'qualified', 'assigned', 'closed', 'lost'))
);

-- ── 3 · Listas cerradas ─────────────────────────────────────────────────────────────
alter table public.buyer_leads drop constraint if exists buyer_leads_source_check;
alter table public.buyer_leads add constraint buyer_leads_source_check
  check (source in ('showing_request', 'loui', 'contact_form', 'manual', 'legacy'));

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

alter table public.buyer_leads drop constraint if exists buyer_leads_exception_code_check;
alter table public.buyer_leads add constraint buyer_leads_exception_code_check
  check (agreement_exception_code is null or agreement_exception_code in
         ('open_house_seller_side', 'unrepresented_buyer_own_listing'));

-- Una solicitud de visita siempre trae el consentimiento de contacto.
alter table public.buyer_leads drop constraint if exists buyer_leads_showing_consent_check;
alter table public.buyer_leads add constraint buyer_leads_showing_consent_check
  check (source <> 'showing_request' or consent_contact_at is not null);

-- ── 4 · Reglas contractuales ────────────────────────────────────────────────────────
-- `not_required`: solo con motivo de catálogo y solo en listings PROPIOS. Cualquier otro
-- tipo: sin código de excepción.
alter table public.buyer_leads drop constraint if exists buyer_leads_exception_rule;
alter table public.buyer_leads add constraint buyer_leads_exception_rule check (
  case when agreement_type = 'not_required'
       then agreement_exception_code is not null and property_id is not null
       else agreement_exception_code is null end
);

-- Sin acuerdo registrado no hay acuerdo firmado, visita confirmada ni visita completada.
alter table public.buyer_leads drop constraint if exists buyer_leads_agreement_before_showing;
alter table public.buyer_leads add constraint buyer_leads_agreement_before_showing check (
  status not in ('agreement_signed', 'showing_confirmed', 'completed')
  or (agreement_recorded_at is not null and agreement_type is not null)
);

-- "Acuerdo firmado" con un acuerdo que no existe sería contradictorio.
alter table public.buyer_leads drop constraint if exists buyer_leads_signed_is_written;
alter table public.buyer_leads add constraint buyer_leads_signed_is_written
  check (status <> 'agreement_signed' or agreement_type is distinct from 'not_required');

-- Solo la broker licenciada (rol `broker`) registra o cambia el acuerdo. Un `admin` sin
-- licencia no puede. Los roles de servidor (service_role, postgres) quedan fuera de esta
-- regla: no los usa ninguna pantalla.
create or replace function public.guard_buyer_leads_agreement()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as '
begin
  if current_user in (''authenticated'', ''anon'') then
    if (tg_op = ''INSERT'' and (new.agreement_type is not null
                                or new.agreement_recorded_at is not null
                                or new.agreement_exception_code is not null))
       or (tg_op = ''UPDATE'' and (new.agreement_type is distinct from old.agreement_type
                                   or new.agreement_recorded_at is distinct from old.agreement_recorded_at
                                   or new.agreement_reference is distinct from old.agreement_reference
                                   or new.agreement_exception_code is distinct from old.agreement_exception_code)) then
      if not public.has_role(''broker'') then
        raise exception ''Only the licensed broker can record buyer agreements.''
          using errcode = ''42501'';
      end if;
    end if;
  end if;
  return new;
end;
';

revoke all on function public.guard_buyer_leads_agreement() from public, anon, authenticated;

drop trigger if exists guard_buyer_leads_agreement on public.buyer_leads;
create trigger guard_buyer_leads_agreement
  before insert or update on public.buyer_leads
  for each row execute function public.guard_buyer_leads_agreement();

create index if not exists buyer_leads_created_idx on public.buyer_leads (created_at desc);

-- ── 5 · Políticas de buyer_leads ────────────────────────────────────────────────────
drop policy if exists "buyer leads own" on public.buyer_leads;
-- Se conserva "buyer leads admin" (is_admin_or_broker) tal como está.

-- ── 6 · Roster de responsables (reutiliza agent_partners) ────────────────────────────
alter table public.agent_partners
  add column if not exists relationship text not null default 'referral_partner',
  add column if not exists brokerage_name text,
  add column if not exists brokerage_license text;

alter table public.agent_partners drop constraint if exists agent_partners_relationship_check;
alter table public.agent_partners add constraint agent_partners_relationship_check
  check (relationship in ('broker_of_record', 'internal_associate', 'referral_partner'));

create unique index if not exists agent_partners_one_broker_of_record
  on public.agent_partners (relationship) where relationship = 'broker_of_record';

drop policy if exists "agents read active" on public.agent_partners;

-- ── 7 · Historial ───────────────────────────────────────────────────────────────────
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
     or new.agreement_recorded_at is distinct from old.agreement_recorded_at
     or new.agreement_exception_code is distinct from old.agreement_exception_code then
    insert into public.buyer_lead_events (lead_id, actor_user_id, event_type, from_value, to_value, note)
      values (new.id, auth.uid(), ''agreement_recorded'', old.agreement_type, new.agreement_type,
              coalesce(new.agreement_exception_code, new.agreement_reference));
  end if;
  return null;
end;
';

revoke all on function public.buyer_lead_events_log() from public, anon, authenticated;

drop trigger if exists buyer_lead_events_log on public.buyer_leads;
create trigger buyer_lead_events_log
  after insert or update on public.buyer_leads
  for each row execute function public.buyer_lead_events_log();

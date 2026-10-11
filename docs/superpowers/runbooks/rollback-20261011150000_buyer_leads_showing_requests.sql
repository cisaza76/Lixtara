-- Rollback de 20261011150000_buyer_leads_showing_requests.
--
-- ANTES DE CORRER ESTO:
--   1. Exportar a CSV (Table Editor → Export) buyer_leads, buyer_lead_events y
--      agent_partners si tienen filas: el rollback BORRA columnas y el historial.
--   2. Revertir primero el código (Vercel → Deployments → Instant Rollback al deploy
--      anterior), porque el código nuevo lee estas columnas.
--
-- Deja el esquema exactamente como en 20260521230143 + 20260521230654. Los leads creados
-- después de la migración conservan contacto y fechas, pero pierden los campos nuevos; los
-- que estén en un estado nuevo pasan a uno equivalente del esquema anterior.
--
-- Sin `$$` ni corchetes: se pega en el SQL Editor. Correr UNA sola vez. Una segunda corrida
-- falla en "column legacy_status does not exist" sin cambiar nada: todo lo anterior a ese
-- punto son `drop ... if exists` que ya no tienen efecto.

drop trigger if exists buyer_lead_events_log on public.buyer_leads;
drop function if exists public.buyer_lead_events_log();
drop trigger if exists guard_buyer_leads_agreement on public.buyer_leads;
drop function if exists public.guard_buyer_leads_agreement();
drop table if exists public.buyer_lead_events;

alter table public.buyer_leads drop constraint if exists buyer_leads_status_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_source_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_other_agent_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_needs_to_sell_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_lang_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_agreement_type_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_exception_code_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_showing_consent_check;
alter table public.buyer_leads drop constraint if exists buyer_leads_exception_rule;
alter table public.buyer_leads drop constraint if exists buyer_leads_agreement_before_showing;
alter table public.buyer_leads drop constraint if exists buyer_leads_signed_is_written;

-- Estados: los históricos vuelven a su valor; los nuevos, al equivalente anterior.
update public.buyer_leads set status = legacy_status where legacy_status is not null;
update public.buyer_leads set status = case status
    when 'received' then 'new'
    when 'contact_pending' then 'new'
    when 'contacted' then 'contacted'
    when 'agreement_pending' then 'qualified'
    when 'agreement_signed' then 'qualified'
    when 'showing_coordinating' then 'qualified'
    when 'showing_confirmed' then 'qualified'
    when 'completed' then 'qualified'
    when 'cancelled' then 'lost'
    else status end
  where status not in ('new', 'contacted', 'qualified', 'assigned', 'closed', 'lost');

alter table public.buyer_leads alter column status set default 'new';
alter table public.buyer_leads add constraint buyer_leads_status_check
  check (status in ('new', 'contacted', 'qualified', 'assigned', 'closed', 'lost'));

drop index if exists public.buyer_leads_created_idx;
alter table public.buyer_leads
  drop column if exists source,
  drop column if exists legacy_status,
  drop column if exists listing_key,
  drop column if exists property_id,
  drop column if exists preferred_times,
  drop column if exists message,
  drop column if exists other_agent_status,
  drop column if exists needs_to_sell,
  drop column if exists lang,
  drop column if exists consent_contact_at,
  drop column if exists consent_marketing_at,
  drop column if exists consent_version,
  drop column if exists handled_by_agent_id,
  drop column if exists agreement_type,
  drop column if exists agreement_recorded_at,
  drop column if exists agreement_reference,
  drop column if exists agreement_exception_code,
  drop column if exists agreement_note,
  drop column if exists cancel_reason;

drop policy if exists "buyer leads own" on public.buyer_leads;
create policy "buyer leads own" on public.buyer_leads for select
  using (auth.uid() = user_id);

drop index if exists public.agent_partners_one_broker_of_record;
alter table public.agent_partners drop constraint if exists agent_partners_relationship_check;
alter table public.agent_partners
  drop column if exists relationship,
  drop column if exists brokerage_name,
  drop column if exists brokerage_license;

drop policy if exists "agents read active" on public.agent_partners;
create policy "agents read active" on public.agent_partners for select
  to authenticated using (status = 'active');

delete from supabase_migrations.schema_migrations where version = '20261011150000';

-- Rollback de 20261029120000_buyer_nbr_notice (aviso NBR). ¡Borra la evidencia de los avisos!
-- Exportar public.buyer_nbr_notices ANTES. Falla si algún lead usa represented_buyer_own_listing.
drop trigger if exists guard_showing_nbr on public.schedule_requests;
drop trigger if exists guard_showing_nbr on public.buyer_leads;
drop function if exists public.guard_showing_nbr();
drop function if exists public.nbr_notice_state(uuid, uuid);
drop trigger if exists guard_buyer_nbr_notices on public.buyer_nbr_notices;
drop function if exists public.guard_buyer_nbr_notices();
drop table if exists public.buyer_nbr_notices;   -- ¡borra la evidencia! exportarla antes
-- (falla si algún lead ya usa represented_buyer_own_listing: cambiarlo antes)
alter table public.buyer_leads drop constraint if exists buyer_leads_exception_code_check;
alter table public.buyer_leads add constraint buyer_leads_exception_code_check
  check (agreement_exception_code is null or agreement_exception_code in
         ('open_house_seller_side', 'unrepresented_buyer_own_listing'));
alter table public.schedule_requests drop constraint if exists schedule_requests_buyer_agent_check;
alter table public.schedule_requests drop column if exists buyer_agent_license,
  drop column if exists buyer_agent_email, drop column if exists buyer_agent_brokerage,
  drop column if exists buyer_agent_name, drop column if exists buyer_agent_status;
alter table public.buyer_leads drop constraint if exists buyer_leads_buyer_agent_len;
alter table public.buyer_leads drop column if exists buyer_agent_license,
  drop column if exists buyer_agent_email, drop column if exists buyer_agent_brokerage,
  drop column if exists buyer_agent_name;

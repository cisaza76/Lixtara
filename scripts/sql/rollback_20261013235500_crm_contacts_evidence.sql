-- Reversión de 20261013235500_crm_contacts_evidence. Borra los objetos que creó esa migración
-- (y su historial: correr solo si las tablas no tienen datos que deban conservarse, o después
-- de un pg_dump). No toca crm_owners ni el resto del CRM salvo las 2 columnas nuevas de
-- crm_property_owners. Después, marcar la migración como revertida:
--   supabase migration repair --status reverted 20261013235500
begin;
drop view if exists public.crm_contacts_activable;
drop view if exists public.crm_contacts_current;
drop table if exists public.crm_experiment_assignments;
drop table if exists public.crm_experiments;
drop table if exists public.crm_contact_eligibility;
drop table if exists public.crm_contact_validations;
drop table if exists public.crm_identity_evidence;
drop table if exists public.crm_contacts;
drop table if exists public.crm_entity_persons;
drop table if exists public.crm_persons;
drop function if exists public.crm_contacts_guard();
drop function if exists public.crm_forbid_change();
alter table public.crm_property_owners drop column if exists evidence_source, drop column if exists observed_on;
commit;

-- Correo frío solo a propietarios con domicilio en EE. UU. (decisión del owner, 2026-10-18).
--
-- crm_sendable_email_owners deja fuera a todo propietario con domicilio fuera de EE. UU.:
-- `domicile = 'FC'` (OWN_STATE_DOM del NAL, o derivado de OWN_STATE por lixtara_base.py) o
-- `is_foreign` (la marca "Extranjero" del mismo script). Aplica a personas naturales Y a
-- entidades extranjeras, hasta que el owner decida otra cosa para las entidades. Ese
-- propietario queda como "solo correo postal": sigue en crm_owners, pero ningún envío de
-- email lo incluye (el botón "Enviar a Instantly" lee SOLO de esta vista).
--
-- Mismo cuerpo que 20261012120000 más las dos condiciones. CREATE OR REPLACE conserva los
-- grants (20261012180000: solo lectura para authenticated, nada para anon); se repiten
-- igual, por si acaso. Idempotente. Rollback:
-- docs/superpowers/runbooks/rollback-20261018170100_crm_sendable_exclude_foreign.sql

begin;

create or replace view public.crm_sendable_email_owners
with (security_invoker = true) as
select o.*,
       (select nullif(concat_ws(', ', nullif(concat_ws(' ', p.address, p.unit), ''), p.city), '')
          from public.crm_property_owners po
          join public.crm_properties p on p.id = po.property_id
         where po.owner_id = o.id
           and po.valid_to is null
         order by p.score desc nulls last, p.just_value desc nulls last, p.id
         limit 1) as property_address
  from public.crm_owners o
 where o.email is not null
   and o.email_verified_at is not null
   and o.outreach_status not in ('Baja','Rebote','No interesado','Persona equivocada')
   -- Domicilio fuera de EE. UU. = solo correo postal.
   and not o.is_foreign
   and upper(btrim(coalesce(o.domicile, ''))) <> 'FC'
   and not exists (
         select 1 from public.crm_suppression s
          where (s.email = o.email or s.owner_id = o.id)
            and s.channel in ('all','email'))
   and not exists (
         select 1
           from public.crm_property_owners po
           join public.crm_properties p on p.id = po.property_id
          where po.owner_id = o.id
            and po.valid_to is null
            and p.mls_status ilike 'activo%');

revoke all on public.crm_sendable_email_owners from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.crm_sendable_email_owners from authenticated;

commit;

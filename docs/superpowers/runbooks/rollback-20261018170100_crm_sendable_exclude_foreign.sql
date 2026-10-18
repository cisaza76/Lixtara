-- Rollback de 20261018170100_crm_sendable_exclude_foreign.
--
-- Devuelve crm_sendable_email_owners a su cuerpo de 20261012120000: los propietarios con
-- domicilio fuera de EE. UU. (domicile = 'FC' / is_foreign) vuelven a poder recibir email.
-- No toca datos. Para volver a aplicar: re-ejecutar la migración (es idempotente).

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

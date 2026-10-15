-- =============================================================================
-- Embudo del vendedor: funnel_events.is_test + vista listing_funnel_v
-- (plan de medición del CMO, doc 18 §6.4; decisiones de Camilo 2026-10-14).
--
-- Desde este cambio, el servidor registra en funnel_events cada hito del registro
-- (src/lib/funnel-events.server.ts): paso terminado (1–7), contrato firmado, salida a
-- Stripe, pago y retoma por enlace. listing_funnel_v da una fila por listing para el
-- tablero de Looker Studio (exportación nocturna a una hoja de Google).
--
-- is_test: Preview usa esta misma base y funnel_events no se edita, así que las pruebas
-- se marcan al escribirlas y la vista las excluye. El servidor marca is_test = true
-- cuando VERCEL_ENV no es 'production', cuando la propiedad tiene is_test = true o
-- cuando Stripe reporta livemode = false. La columna no tiene default: quien escribe
-- tiene que decidirlo. Las filas que existan al aplicar quedan en false (hasta hoy
-- ningún código escribe en esta tabla).
--
-- Sin datos personales: la vista no expone correo, nombre, teléfono ni dirección.
-- Solo crea la vista y agrega una columna; no toca datos existentes.
-- Reversión: scripts/sql/rollback_20261014150000_listing_funnel_view.sql
-- =============================================================================

alter table public.funnel_events add column if not exists is_test boolean;
update public.funnel_events set is_test = false where is_test is null;
alter table public.funnel_events alter column is_test set not null;
alter table public.funnel_events alter column is_test drop default;

comment on column public.funnel_events.is_test is
  'true = evento de prueba (VERCEL_ENV distinto de production, propiedad is_test o Stripe livemode=false). listing_funnel_v lo excluye.';

create index if not exists funnel_events_property_idx
  on public.funnel_events (property_id, created_at) where property_id is not null;

-- -----------------------------------------------------------------------------
-- Una fila por listing con al menos un evento real. Hitos = PRIMERA vez que ocurrieron.
-- last_step_reached = el paso al que llegó: el siguiente al último terminado (8 si pagó).
-- UTM de primer contacto: las guarda el paso 1 solo si la persona aceptó cookies.
-- -----------------------------------------------------------------------------
create or replace view public.listing_funnel_v
with (security_invoker = true) as
with ev as (
  select f.id, f.property_id, f.event, f.step, f.metadata, f.created_at
    from public.funnel_events f
   where f.is_test = false
     and f.property_id is not null
),
hitos as (
  select property_id,
         min(created_at) filter (where event = 'listing_step_complete' and step = 1) as step1_completed_at,
         min(created_at) filter (where event = 'listing_step_complete' and step = 2) as step2_completed_at,
         min(created_at) filter (where event = 'listing_step_complete' and step = 3) as step3_completed_at,
         min(created_at) filter (where event = 'listing_step_complete' and step = 4) as step4_completed_at,
         min(created_at) filter (where event = 'listing_step_complete' and step = 5) as step5_completed_at,
         min(created_at) filter (where event = 'listing_step_complete' and step = 6) as step6_completed_at,
         min(created_at) filter (where event = 'listing_step_complete' and step = 7) as step7_completed_at,
         min(created_at) filter (where event = 'agreement_signed')                    as agreement_signed_at,
         min(created_at) filter (where event = 'checkout_started')                    as checkout_started_at,
         min(created_at) filter (where event = 'listing_paid')                        as paid_at,
         max(step)       filter (where event = 'listing_step_complete')               as max_step_completed,
         bool_or(event = 'listing_resumed')                                           as resumed_via_link
    from ev
   group by property_id
),
idioma as (
  select distinct on (property_id) property_id, metadata ->> 'lang' as lang
    from ev
   where metadata ->> 'lang' in ('en', 'es')
   order by property_id, created_at, id
),
origen as (
  select distinct on (property_id) property_id,
         metadata ->> 'utm_source'   as utm_source,
         metadata ->> 'utm_medium'   as utm_medium,
         metadata ->> 'utm_campaign' as utm_campaign
    from ev
   where event = 'listing_step_complete' and step = 1
   order by property_id, created_at, id
),
pago as (
  select distinct on (property_id) property_id,
         case when jsonb_typeof(metadata -> 'amount') = 'number'
              then (metadata ->> 'amount')::numeric end as amount_paid
    from ev
   where event = 'listing_paid'
   order by property_id, created_at, id
)
select p.id                    as listing_id,
       p.created_at,
       i.lang,
       p.pricing_tier          as plan_tier,
       h.step1_completed_at,
       h.step2_completed_at,
       h.step3_completed_at,
       h.step4_completed_at,
       h.step5_completed_at,
       h.step6_completed_at,
       h.step7_completed_at,
       h.agreement_signed_at,
       h.checkout_started_at,
       h.paid_at,
       pg.amount_paid,
       case when h.paid_at is not null then 8
            when h.max_step_completed is null then 1
            else least(h.max_step_completed + 1, 8)
       end::smallint           as last_step_reached,
       coalesce(h.resumed_via_link, false) as resumed_via_link,
       o.utm_source,
       o.utm_medium,
       o.utm_campaign
  from hitos h
  join public.properties p on p.id = h.property_id
  left join idioma i  on i.property_id  = h.property_id
  left join origen o  on o.property_id  = h.property_id
  left join pago   pg on pg.property_id = h.property_id
 where p.is_test = false;

comment on view public.listing_funnel_v is
  'Embudo del vendedor, una fila por listing real (sin is_test). Sin datos personales. Lectura: admin/broker (RLS de funnel_events y properties) y la exportación nocturna (service role).';

-- Solo lectura. security_invoker: quien consulta necesita poder leer funnel_events
-- (admin/broker por RLS); anon no tiene nada.
revoke all on public.listing_funnel_v from anon;
revoke insert, update, delete, truncate, references, trigger on public.listing_funnel_v from authenticated;
grant select on public.listing_funnel_v to authenticated, service_role;

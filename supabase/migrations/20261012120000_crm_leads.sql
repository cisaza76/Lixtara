-- =============================================================================
-- Lixtara CRM — base de propietarios, campañas y supresión
-- Fuente de datos: salidas de lixtara_base.py (NAL FL DOR + Sunbiz + señales)
-- Prefijo crm_ para no chocar con las tablas de la app (properties, users, …)
-- Acceso: staff de Lixtara (admin o broker de user_roles) vía RLS, a través de
-- is_crm_admin(). El webhook de outreach (ruta de Next) y el importador usan
-- service_role / postgres, que ignoran RLS.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Acceso al CRM
-- No hay tabla propia de admins: el acceso es el mismo del panel de admin
-- (user_roles admin o broker, vía is_admin_or_broker()). El fotógrafo no entra.
-- La broker entra porque supervisa legalmente la publicidad de la brokerage y
-- debe ver campañas y respuestas.
-- OJO: si algún día entran más brokers (o cualquier rol nuevo pasa a
-- is_admin_or_broker()), revisar este acceso: estas tablas tienen datos
-- personales de propietarios que no son clientes de Lixtara.
-- -----------------------------------------------------------------------------
create or replace function public.is_crm_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.is_admin_or_broker();
$$;

revoke all on function public.is_crm_admin() from public, anon;
grant execute on function public.is_crm_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Propietarios (personas naturales, trusts, sucesiones y entidades)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_owners (
  id                      uuid primary key default gen_random_uuid(),
  owner_key               text not null unique,            -- hash de lixtara_base.py
  owner_type              text not null check (owner_type in
                            ('Persona Natural','Trust','Sucesión','LLC','Corporación',
                             'Sociedad','Entidad (sin sufijo)')),
  registered_name         text not null,                   -- tal como figura en el roll
  mail_line1              text,
  mail_line2              text,
  mail_city               text,
  mail_state_country      text,
  mail_zip                text,
  domicile                text,                            -- OWN_STATE_DOM ("FC" = extranjero)
  is_absentee             boolean not null default false,
  is_foreign              boolean not null default false,
  is_out_of_state         boolean not null default false,
  num_properties          integer not null default 0,
  portfolio_value         numeric(14,2),
  score                   integer,
  has_strong_signal       boolean not null default false,
  priority                text check (priority in ('A','B','C')),
  pilot_group             text check (pilot_group in ('Score','Control')),
  -- Sunbiz (solo entidades)
  sunbiz_match            text,
  sunbiz_doc              text,
  sunbiz_status           text,
  sunbiz_filing_type      text,
  sunbiz_formed_on        date,
  sunbiz_registered_agent text,
  sunbiz_managers         text[],
  -- Contacto: lo llena el skip tracing / verificación, nunca el roll
  email                   text,
  email_source            text,
  email_verified_at       timestamptz,
  phone                   text,
  phone_source            text,
  dnc_status              text not null default 'Pendiente'
                            check (dnc_status in ('Pendiente','Limpio','En DNC')),
  -- Estado comercial (lo actualiza el trigger de outreach)
  outreach_status         text not null default 'Sin contactar'
                            check (outreach_status in ('Sin contactar','Contactado','Respondió',
                              'Interesado','No interesado','Baja','Rebote','Persona equivocada')),
  last_event_at           timestamptz,
  -- Trazabilidad
  source                  text not null,
  collected_on            date not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint crm_owners_email_lower check (email is null or email = lower(email))
);

create unique index if not exists crm_owners_email_uq on public.crm_owners (email) where email is not null;
create index if not exists crm_owners_priority_idx on public.crm_owners (priority, score desc);
create index if not exists crm_owners_type_idx on public.crm_owners (owner_type);

drop trigger if exists crm_owners_touch on public.crm_owners;
create trigger crm_owners_touch before update on public.crm_owners
  for each row execute function public.crm_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Propiedades (una fila por parcela)
-- -----------------------------------------------------------------------------
create table if not exists public.crm_properties (
  id                 uuid primary key default gen_random_uuid(),
  county             text not null,
  folio              text not null check (folio ~ '^[0-9]+$'),   -- solo dígitos, texto (conserva ceros)
  mls_number         text unique,
  address            text,
  unit               text,
  city               text,
  zip                text,
  use_code           text,
  property_type      text,
  just_value         numeric(14,2),
  year_built         integer,
  living_area_sqft   integer,
  units              integer,
  recent_sale_year   integer,
  recent_sale_price  numeric(14,2),
  is_recent_purchase boolean not null default false,
  score              integer,
  has_strong_signal  boolean not null default false,
  priority           text check (priority in ('A','B','C')),
  -- mls_status (y la señal 'mls_expirado') llegan de CSV que Camilo carga a mano.
  -- NUNCA salen del feed de Bridge / MIAMI: esa licencia IDX solo permite mostrar
  -- listados en lixtara.com (Schedule B §1, §IX.J; ADR-0013), no prospectar.
  -- Si un export manual de Matrix sirve como fuente está pendiente de respuesta del MLS.
  mls_status         text,
  source             text not null,
  collected_on       date not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (county, folio)
);

create index if not exists crm_properties_zip_idx on public.crm_properties (zip);
create index if not exists crm_properties_priority_idx on public.crm_properties (priority, score desc);

drop trigger if exists crm_properties_touch on public.crm_properties;
create trigger crm_properties_touch before update on public.crm_properties
  for each row execute function public.crm_touch_updated_at();

-- Relación propiedad ↔ propietario (con vigencia, para la reconciliación anual)
create table if not exists public.crm_property_owners (
  property_id uuid not null references public.crm_properties (id) on delete cascade,
  owner_id    uuid not null references public.crm_owners (id) on delete cascade,
  valid_from  date not null default current_date,
  valid_to    date,                                        -- null = vigente
  end_reason  text,                                        -- ej. 'Transferido (probable tax deed)'
  primary key (property_id, owner_id)
);
create index if not exists crm_property_owners_owner_idx on public.crm_property_owners (owner_id);

-- Señales por parcela
create table if not exists public.crm_property_signals (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.crm_properties (id) on delete cascade,
  signal      text not null check (signal in
                ('lis_pendens','probate','impuestos_morosos','mls_expirado','codigo')),
  source      text not null,
  observed_on date not null,
  created_at  timestamptz not null default now(),
  unique (property_id, signal)
);

-- -----------------------------------------------------------------------------
-- Campañas, eventos de outreach y supresión
-- -----------------------------------------------------------------------------
create table if not exists public.crm_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  channel              text not null check (channel in ('email','postal')),
  provider             text not null,                      -- 'instantly', 'smartlead', 'lob', …
  provider_campaign_id text,
  segment              jsonb not null default '{}'::jsonb, -- filtros usados para armar el envío
  status               text not null default 'Borrador'
                         check (status in ('Borrador','Activa','Pausada','Terminada')),
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, provider_campaign_id)
);

drop trigger if exists crm_campaigns_touch on public.crm_campaigns;
create trigger crm_campaigns_touch before update on public.crm_campaigns
  for each row execute function public.crm_touch_updated_at();

-- Quién entró a cada campaña (snapshot del segmento enviado)
create table if not exists public.crm_campaign_members (
  campaign_id uuid not null references public.crm_campaigns (id) on delete cascade,
  owner_id    uuid not null references public.crm_owners (id) on delete cascade,
  pilot_group text,
  added_at    timestamptz not null default now(),
  primary key (campaign_id, owner_id)
);

create table if not exists public.crm_outreach (
  id                   uuid primary key default gen_random_uuid(),
  event_hash           text not null unique,               -- idempotencia de webhooks
  provider             text not null,
  event_type           text not null,                      -- tal como lo envía el proveedor
  owner_id             uuid references public.crm_owners (id) on delete set null,
  campaign_id          uuid references public.crm_campaigns (id) on delete set null,
  provider_campaign_id text,
  email                text,
  step                 integer,
  reply_subject        text,
  reply_text           text,
  payload              jsonb not null,
  occurred_at          timestamptz not null,
  created_at           timestamptz not null default now(),
  -- Bandeja de respuestas: staff solo puede marcar/desmarcar estas dos columnas,
  -- y solo a través de crm_set_outreach_handled() (no hay política de UPDATE).
  handled_at           timestamptz,
  handled_by           uuid references auth.users (id) on delete set null
);
create index if not exists crm_outreach_owner_idx on public.crm_outreach (owner_id, occurred_at desc);
create index if not exists crm_outreach_type_idx on public.crm_outreach (event_type, occurred_at desc);
create index if not exists crm_outreach_inbox_idx on public.crm_outreach (occurred_at desc)
  where handled_at is null and event_type in ('reply_received','lead_interested');

-- Lista de supresión global: nadie aquí recibe otro envío, por ningún proveedor
create table if not exists public.crm_suppression (
  id         uuid primary key default gen_random_uuid(),
  email      text unique check (email is null or email = lower(email)),
  -- set null, no cascade: borrar o reimportar un propietario nunca borra su supresión.
  -- Si la fila no tiene email, el check de abajo impide el set null y por lo tanto el
  -- borrado del propietario: hay que resolverlo a mano, a propósito.
  owner_id   uuid unique references public.crm_owners (id) on delete set null,
  channel    text not null default 'all' check (channel in ('all','email','postal','phone')),
  reason     text not null check (reason in
               ('unsubscribe','bounce','complaint','not_interested','wrong_person','manual')),
  source     text not null,
  created_at timestamptz not null default now(),
  check (email is not null or owner_id is not null)
);

-- -----------------------------------------------------------------------------
-- Trigger: cada evento actualiza el estado del propietario y alimenta la supresión
-- (la lógica vive en la base para que cualquier proveedor la respete igual)
-- -----------------------------------------------------------------------------
-- Precedencia del estado comercial (pura, para poder probarla aislada):
--   * Baja, Rebote y Persona equivocada son terminales: nada los cambia.
--   * No interesado solo lo cambia Interesado.
--   * Interesado no baja a Respondió ni a Contactado.
--   * Contactado solo aplica sobre Sin contactar.
create or replace function public.crm_next_outreach_status(p_current text, p_incoming text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_incoming is null then p_current
    when p_current in ('Baja','Rebote','Persona equivocada') then p_current
    when p_current = 'No interesado' and p_incoming <> 'Interesado' then p_current
    when p_current = 'Interesado' and p_incoming in ('Respondió','Contactado') then p_current
    when p_incoming = 'Contactado' and p_current <> 'Sin contactar' then p_current
    else p_incoming
  end;
$$;

create or replace function public.crm_apply_outreach_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_reason text;
begin
  v_status := case new.event_type
    when 'email_sent'          then 'Contactado'
    when 'reply_received'      then 'Respondió'
    when 'lead_interested'     then 'Interesado'
    when 'lead_meeting_booked' then 'Interesado'
    when 'lead_not_interested' then 'No interesado'
    when 'lead_unsubscribed'   then 'Baja'
    when 'email_bounced'       then 'Rebote'
    when 'lead_wrong_person'   then 'Persona equivocada'
    else null
  end;

  v_reason := case new.event_type
    when 'lead_unsubscribed'   then 'unsubscribe'
    when 'email_bounced'       then 'bounce'
    when 'lead_not_interested' then 'not_interested'
    when 'lead_wrong_person'   then 'wrong_person'
    else null
  end;

  if new.owner_id is not null and v_status is not null then
    update public.crm_owners o
       set outreach_status = public.crm_next_outreach_status(o.outreach_status, v_status),
           last_event_at = greatest(coalesce(o.last_event_at, new.occurred_at), new.occurred_at)
     where o.id = new.owner_id;
  end if;

  if v_reason is not null and new.email is not null then
    insert into public.crm_suppression (email, owner_id, channel, reason, source)
    values (lower(new.email),
            new.owner_id,
            case when v_reason = 'bounce' then 'email' else 'all' end,
            v_reason,
            new.provider || ':' || new.event_type)
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists crm_outreach_apply on public.crm_outreach;
create trigger crm_outreach_apply after insert on public.crm_outreach
  for each row execute function public.crm_apply_outreach_event();

-- Marcar (o desmarcar) un evento de la bandeja como gestionado. Única vía de
-- escritura de staff sobre crm_outreach: no toca ninguna otra columna.
create or replace function public.crm_set_outreach_handled(p_outreach_id uuid, p_handled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_crm_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.crm_outreach
     set handled_at = case when p_handled then now() else null end,
         handled_by = case when p_handled then auth.uid() else null end
   where id = p_outreach_id;
  if not found then
    raise exception 'outreach event not found' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.crm_set_outreach_handled(uuid, boolean) from public, anon;
grant execute on function public.crm_set_outreach_handled(uuid, boolean) to authenticated;

-- Las funciones de trigger no se invocan por RPC.
revoke all on function public.crm_apply_outreach_event() from public, anon, authenticated;
revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Vista: propietarios que SÍ se pueden incluir en un envío de email
-- (email verificado, sin supresión, sin propiedad con listado activo en MLS)
-- -----------------------------------------------------------------------------
create or replace view public.crm_sendable_email_owners
with (security_invoker = true) as
select o.*
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

-- -----------------------------------------------------------------------------
-- RLS: solo staff del CRM (is_crm_admin)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['crm_owners','crm_properties','crm_property_owners',
                           'crm_property_signals','crm_campaigns','crm_campaign_members',
                           'crm_outreach','crm_suppression']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- RLS no cubre TRUNCATE/REFERENCES/TRIGGER: se quitan aparte.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;

  -- Tablas de trabajo: staff lee y escribe.
  foreach t in array array['crm_owners','crm_properties','crm_property_owners',
                           'crm_property_signals','crm_campaigns','crm_campaign_members']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_crm_admin()) with check (public.is_crm_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

-- crm_outreach: los eventos los escribe el webhook (service_role). Staff solo lee;
-- marcar como gestionado pasa por crm_set_outreach_handled().
revoke insert, update, delete on public.crm_outreach from authenticated;
drop policy if exists crm_outreach_admin_select on public.crm_outreach;
create policy crm_outreach_admin_select on public.crm_outreach
  for select to authenticated using (public.is_crm_admin());

-- crm_suppression: global y permanente. Staff lee e inserta; nadie fuera de
-- service_role la actualiza ni la borra.
revoke update, delete on public.crm_suppression from authenticated;
drop policy if exists crm_suppression_admin_select on public.crm_suppression;
create policy crm_suppression_admin_select on public.crm_suppression
  for select to authenticated using (public.is_crm_admin());
drop policy if exists crm_suppression_admin_insert on public.crm_suppression;
create policy crm_suppression_admin_insert on public.crm_suppression
  for insert to authenticated with check (public.is_crm_admin());

revoke all on public.crm_sendable_email_owners from anon;

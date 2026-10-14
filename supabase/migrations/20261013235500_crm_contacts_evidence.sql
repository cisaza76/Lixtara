-- =============================================================================
-- CRM: contactos con historial, evidencia de identidad, validaciones, elegibilidad
-- y experimentos (piloto de 100 emails, plan aprobado 2026-10-13).
--
-- Por qué: crm_owners.email es una sola columna sobrescribible, sin historial ni
-- evidencia. Aquí cada contacto es una fila propia (UUID, fuente, vínculo con su
-- propietario) y todo lo que se sabe de él se AGREGA, nunca se edita:
--   * crm_identity_evidence   — por qué pertenece al titular (Clase A/B/C)
--   * crm_contact_validations — estado técnico (MX, SMTP)
--   * crm_contact_eligibility — apto / no apto para campaña, con fundamento
-- El estado vigente es la última fila de cada tabla (vista crm_contacts_current).
-- Solo es activable un email Clase A + elegible + verificado 'valid' + no suprimido.
--
-- Las respuestas crudas del proveedor (con teléfonos de terceros) NO suben: viven en
-- el ledger local del pipeline; ledger_ref apunta a esa fila.
--
-- Solo crea objetos nuevos y agrega 2 columnas nulas: no toca datos existentes.
-- Reversión: scripts/sql/rollback_20261013235500_crm_contacts_evidence.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Personas físicas y su relación con entidades (Sunbiz). Un rol en una entidad
-- NO implica propiedad económica.
-- -----------------------------------------------------------------------------
create table if not exists public.crm_persons (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  first_name text,
  last_name  text,
  source     text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_entity_persons (
  entity_owner_id uuid not null references public.crm_owners (id) on delete restrict,
  person_id       uuid not null references public.crm_persons (id) on delete restrict,
  role            text not null check (role in ('manager','officer','registered_agent','authorized_person')),
  title           text,                                   -- título Sunbiz tal cual (MGR, AMBR, P…)
  source          text not null,
  observed_on     date not null,
  created_at      timestamptz not null default now(),
  primary key (entity_owner_id, person_id, role)
);

-- -----------------------------------------------------------------------------
-- Contactos: una fila por (propietario, tipo, valor). El valor nunca se edita.
-- -----------------------------------------------------------------------------
create table if not exists public.crm_contacts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.crm_owners (id) on delete restrict,
  person_id  uuid references public.crm_persons (id) on delete restrict,
  type       text not null check (type in ('email','phone','postal')),
  value      text not null check (length(btrim(value)) > 0),
  country    text,
  source     text not null,                               -- 'batchdata:property-skip-trace-v3', …
  ledger_ref text unique,                                 -- contact_id del ledger local
  created_at timestamptz not null default now(),
  check (type <> 'email' or value = lower(value)),
  unique (owner_id, type, value)
);
create index if not exists crm_contacts_value_idx on public.crm_contacts (type, value);

create table if not exists public.crm_identity_evidence (
  id            bigint generated always as identity primary key,
  contact_id    uuid not null references public.crm_contacts (id) on delete restrict,
  class         text not null check (class in ('A','B','C')),
  rule          text not null,
  evidence      jsonb not null default '{}'::jsonb,       -- campos coincidentes, banderas, confianza
  rules_version text not null,
  created_at    timestamptz not null default now()
);
create index if not exists crm_identity_evidence_contact_idx on public.crm_identity_evidence (contact_id, id desc);

create table if not exists public.crm_contact_validations (
  id         bigint generated always as identity primary key,
  contact_id uuid not null references public.crm_contacts (id) on delete restrict,
  status     text not null check (status in
               ('valid','invalid','risky','unknown','mx_ok','mx_fail','mx_unknown')),
  method     text not null,                               -- 'dns_mx', 'smtp:<proveedor>'
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_contact_validations_contact_idx on public.crm_contact_validations (contact_id, id desc);

create table if not exists public.crm_contact_eligibility (
  id         bigint generated always as identity primary key,
  contact_id uuid not null references public.crm_contacts (id) on delete restrict,
  eligible   boolean not null,
  basis      text not null,                               -- fundamento (legal / técnico)
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now()
);
create index if not exists crm_contact_eligibility_contact_idx on public.crm_contact_eligibility (contact_id, id desc);

-- -----------------------------------------------------------------------------
-- Experimentos: asignación aleatoria con seed registrada. Inmutable.
-- -----------------------------------------------------------------------------
create table if not exists public.crm_experiments (
  id         text primary key,                            -- 'email-barrios-2026-10-13'
  name       text not null,
  channel    text not null check (channel in ('email','postal')),
  seed       bigint not null,
  strata     text not null,                               -- definición de los estratos
  population integer not null check (population >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.crm_experiment_assignments (
  experiment_id text not null references public.crm_experiments (id) on delete restrict,
  owner_id      uuid not null references public.crm_owners (id) on delete restrict,
  stratum       text not null,
  arm           text not null check (arm in ('Score','Control')),
  created_at    timestamptz not null default now(),
  primary key (experiment_id, owner_id)
);

-- Evidencia de titularidad en la relación propiedad-propietario existente.
alter table public.crm_property_owners
  add column if not exists evidence_source text,
  add column if not exists observed_on     date;

-- -----------------------------------------------------------------------------
-- Append-only: nadie (ni service_role) edita ni borra historial. El valor de un
-- contacto tampoco cambia: un email distinto es otro contacto.
-- -----------------------------------------------------------------------------
create or replace function public.crm_forbid_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '%: % no permitido (tabla append-only)', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

create or replace function public.crm_contacts_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'crm_contacts: DELETE no permitido (el historial se conserva)' using errcode = 'P0001';
  end if;
  if new.owner_id is distinct from old.owner_id or new.type is distinct from old.type
     or new.value is distinct from old.value or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at then
    raise exception 'crm_contacts: owner_id, type, value, source y created_at son inmutables'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_forbid_change() from public, anon, authenticated;
revoke all on function public.crm_contacts_guard() from public, anon, authenticated;

drop trigger if exists crm_contacts_guard on public.crm_contacts;
create trigger crm_contacts_guard before update or delete on public.crm_contacts
  for each row execute function public.crm_contacts_guard();

do $$
declare t text;
begin
  foreach t in array array['crm_identity_evidence','crm_contact_validations','crm_contact_eligibility',
                           'crm_experiments','crm_experiment_assignments','crm_entity_persons']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I
                      for each row execute function public.crm_forbid_change()', t || '_append_only', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Estado vigente y contactos activables
-- -----------------------------------------------------------------------------
create or replace view public.crm_contacts_current
with (security_invoker = true) as
select c.id, c.owner_id, c.person_id, c.type, c.value, c.country, c.source, c.ledger_ref, c.created_at,
       e.class, e.rule, e.rules_version,
       v.status as validation_status, v.method as validation_method, v.checked_at as validated_at,
       g.eligible, g.basis as eligibility_basis, g.decided_at as eligibility_decided_at
  from public.crm_contacts c
  left join lateral (select class, rule, rules_version from public.crm_identity_evidence
                      where contact_id = c.id order by id desc limit 1) e on true
  left join lateral (select status, method, checked_at from public.crm_contact_validations
                      where contact_id = c.id order by id desc limit 1) v on true
  left join lateral (select eligible, basis, decided_at from public.crm_contact_eligibility
                      where contact_id = c.id order by id desc limit 1) g on true;

-- Activable = Clase A + elegible + verificado por SMTP ('valid') + sin supresión (por email o
-- por propietario, canal all/email). Lo que no cumple todo queda fuera, sin excepciones.
create or replace view public.crm_contacts_activable
with (security_invoker = true) as
select cc.*
  from public.crm_contacts_current cc
 where cc.type = 'email'
   and cc.class = 'A'
   and cc.eligible is true
   and cc.validation_status = 'valid'
   and not exists (select 1 from public.crm_suppression s
                    where s.channel in ('all','email')
                      and (s.email = cc.value or s.owner_id = cc.owner_id));

-- -----------------------------------------------------------------------------
-- RLS y privilegios: staff del CRM (is_crm_admin) lee e inserta; nadie actualiza
-- ni borra salvo lo que permiten los triggers (nada). Experimentos: los escribe el
-- pipeline (service_role); staff solo lee.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['crm_persons','crm_entity_persons','crm_contacts','crm_identity_evidence',
                           'crm_contact_validations','crm_contact_eligibility','crm_experiments',
                           'crm_experiment_assignments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_crm_admin())',
                   t || '_admin_select', t);
  end loop;

  foreach t in array array['crm_persons','crm_entity_persons','crm_contacts','crm_identity_evidence',
                           'crm_contact_validations','crm_contact_eligibility']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_crm_admin())',
                   t || '_admin_insert', t);
  end loop;
end $$;

revoke insert on public.crm_experiments, public.crm_experiment_assignments from authenticated;

revoke all on public.crm_contacts_current, public.crm_contacts_activable from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.crm_contacts_current, public.crm_contacts_activable from authenticated;

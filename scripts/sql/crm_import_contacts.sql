-- Carga de emails del skip tracing: crm_contacts + evidencia + validación + elegibilidad
-- (append-only, migración 20261013235500) y, solo para contactos Clase A elegibles, crm_owners.email
-- (lo que lee crm_sendable_email_owners). Lo ejecuta scripts/import_contacts.py
-- dentro de UNA transacción, después de llenar la tabla temporal stg_contacts; los casos de
-- scripts/db-checks/crm-contacts-*.sql ejecutan este MISMO archivo.
--
-- Entrada (temp, la crea quien llama):
--   stg_contacts(row_no int, owner_key text, email text, email_source text, verification text,
--                class text, rule text, rules_version text, evidence text, ledger_ref text,
--                eligible text, eligibility_basis text, verification_method text, validated_at text)
-- Salida (temp): stg_contacts_eval, una fila por fila de entrada con su `outcome`.
--
-- Reglas:
--   * Toda fila válida (propietario conocido, email bien formado, fuente, clase A/B/C, regla,
--     versión de reglas, elegibilidad con fundamento) queda registrada en crm_contacts con su
--     evidencia, validación y elegibilidad. Solo se agrega una fila de historial si cambió.
--   * Solo un contacto Clase A con eligible = true puede llegar a crm_owners.email; el resto
--     queda `recorded_only` (registrado, no enviable).
--   * Solo `valid` marca email_verified_at (= enviable). `invalid` y `risky` nunca se cargan
--     como enviables: si coinciden con el email actual, lo desmarcan (email_verified_at = null).
--   * `unknown` carga el email sin verificar, salvo que el propietario ya tenga uno verificado.
--   * Nunca se sobrescribe un email que esté en crm_suppression, y nunca se carga uno que ya
--     esté suprimido.
--   * Un email no puede quedar en dos propietarios (índice único): si ya es de otro, se omite.
--   * Filas repetidas para el mismo owner_key, o el mismo email para dos owner_key, se omiten
--     todas: no se adivina cuál es la buena. Excepción: una fila invalid/risky que coincide
--     con el email actual verificado lo desmarca igual.

create temp table stg_contacts_eval on commit drop as
with norm as (
  select row_no,
         nullif(btrim(owner_key), '') as owner_key,
         nullif(lower(btrim(email)), '') as email,
         nullif(btrim(email_source), '') as email_source,
         lower(btrim(coalesce(verification, ''))) as verification,
         upper(nullif(btrim(class), '')) as class,
         nullif(btrim(rule), '') as rule,
         nullif(btrim(rules_version), '') as rules_version,
         coalesce(nullif(btrim(evidence), ''), '{}') as evidence,
         nullif(btrim(ledger_ref), '') as ledger_ref,
         case lower(btrim(coalesce(eligible, ''))) when 'true' then true when 'false' then false end as eligible,
         nullif(btrim(eligibility_basis), '') as eligibility_basis,
         nullif(btrim(verification_method), '') as verification_method,
         nullif(btrim(validated_at), '')::timestamptz as validated_at
    from stg_contacts
),
dups as (
  select n.*,
         count(*) over (partition by owner_key) as rows_for_owner,
         count(*) over (partition by email) as rows_for_email
    from norm n
)
select d.row_no, d.owner_key, d.email, d.email_source, d.verification, d.class, d.rule, d.rules_version,
       d.evidence, d.ledger_ref, d.eligible, d.eligibility_basis, d.verification_method, d.validated_at,
       o.id as owner_id, o.email as current_email, o.email_verified_at as current_verified_at,
       case
         when d.verification not in ('valid', 'invalid', 'risky', 'unknown') then 'bad_status'
         when d.email is null or d.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'bad_email'
         when d.email_source is null then 'missing_source'
         when o.id is null then 'unknown_owner'
         when d.class is null or d.class not in ('A', 'B', 'C') or d.rule is null or d.rules_version is null
              or d.eligible is null or d.eligibility_basis is null then 'missing_evidence'
         -- invalid / risky sobre el email actual verificado: se desmarca SIEMPRE, aunque la
         -- fila esté repetida (desmarcar solo reduce lo enviable; nunca es riesgoso).
         when d.verification in ('invalid', 'risky') and d.email = o.email
              and o.email_verified_at is not null then 'demoted'
         when d.rows_for_owner > 1 then 'duplicate_owner_in_file'
         when d.rows_for_email > 1 then 'duplicate_email_in_file'
         -- invalid / risky: nunca enviables
         when d.verification in ('invalid', 'risky') then 'rejected_' || d.verification
         -- solo Clase A elegible llega a crm_owners
         when d.class <> 'A' or not d.eligible then 'recorded_only'
         -- protección de la supresión
         when o.email is not null and exists (select 1 from public.crm_suppression s where s.email = o.email)
           then 'kept_suppressed_current'
         when exists (select 1 from public.crm_suppression s where s.email = d.email)
           then 'skipped_suppressed_new'
         when exists (select 1 from public.crm_owners x where x.email = d.email and x.id <> o.id)
           then 'skipped_email_taken'
         -- valid / unknown
         when d.verification = 'valid' and d.email = o.email then 'reverified'
         when d.verification = 'valid' then 'loaded_valid'
         when o.email_verified_at is not null then 'kept_verified'
         when d.email = o.email then 'unchanged_unverified'
         else 'loaded_unverified'
       end as outcome
  from dups d
  left join public.crm_owners o on o.owner_key = d.owner_key;

update public.crm_owners o
   set email = e.email,
       email_source = e.email_source,
       email_verified_at = case e.outcome
                             when 'demoted' then null
                             when 'loaded_unverified' then null
                             else now()
                           end
  from stg_contacts_eval e
 where e.owner_id = o.id
   and e.outcome in ('loaded_valid', 'reverified', 'loaded_unverified', 'demoted');

-- -----------------------------------------------------------------------------
-- Historial append-only (crm_contacts y sus tablas de estado)
-- -----------------------------------------------------------------------------
create temp table stg_contacts_rec on commit drop as
select e.*, (e.evidence)::jsonb as evidence_json
  from stg_contacts_eval e
 where e.outcome not in ('bad_status', 'bad_email', 'missing_source', 'unknown_owner', 'missing_evidence');

insert into public.crm_contacts (owner_id, type, value, source, ledger_ref)
select distinct on (owner_id, email) owner_id, 'email', email, email_source, ledger_ref
  from stg_contacts_rec
 order by owner_id, email, row_no
on conflict (owner_id, type, value) do nothing;

alter table stg_contacts_rec add column contact_id uuid;
update stg_contacts_rec r set contact_id = c.id
  from public.crm_contacts c where c.owner_id = r.owner_id and c.type = 'email' and c.value = r.email;

insert into public.crm_identity_evidence (contact_id, class, rule, evidence, rules_version)
select distinct on (r.contact_id) r.contact_id, r.class, r.rule, r.evidence_json, r.rules_version
  from stg_contacts_rec r
  left join lateral (select class, rule, rules_version from public.crm_identity_evidence
                      where contact_id = r.contact_id order by id desc limit 1) l on true
 where l.class is distinct from r.class or l.rule is distinct from r.rule
    or l.rules_version is distinct from r.rules_version
 order by r.contact_id, r.row_no desc;

insert into public.crm_contact_validations (contact_id, status, method, checked_at)
select distinct on (r.contact_id) r.contact_id, r.verification, coalesce(r.verification_method, 'import:' || r.email_source),
       coalesce(r.validated_at, now())
  from stg_contacts_rec r
  left join lateral (select status, method from public.crm_contact_validations
                      where contact_id = r.contact_id order by id desc limit 1) l on true
 where l.status is distinct from r.verification
    or l.method is distinct from coalesce(r.verification_method, 'import:' || r.email_source)
 order by r.contact_id, r.row_no desc;

insert into public.crm_contact_eligibility (contact_id, eligible, basis)
select distinct on (r.contact_id) r.contact_id, r.eligible, r.eligibility_basis
  from stg_contacts_rec r
  left join lateral (select eligible, basis from public.crm_contact_eligibility
                      where contact_id = r.contact_id order by id desc limit 1) l on true
 where l.eligible is distinct from r.eligible or l.basis is distinct from r.eligibility_basis
 order by r.contact_id, r.row_no desc;

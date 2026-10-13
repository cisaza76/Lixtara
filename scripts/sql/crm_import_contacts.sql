-- Carga de emails del skip tracing en crm_owners. Lo ejecuta scripts/import_contacts.py
-- dentro de UNA transacción, después de llenar la tabla temporal stg_contacts; los casos de
-- scripts/db-checks/crm-contacts-*.sql ejecutan este MISMO archivo.
--
-- Entrada (temp, la crea quien llama):
--   stg_contacts(row_no int, owner_key text, email text, email_source text, verification text)
-- Salida (temp): stg_contacts_eval, una fila por fila de entrada con su `outcome`.
--
-- Reglas:
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
         lower(btrim(coalesce(verification, ''))) as verification
    from stg_contacts
),
dups as (
  select n.*,
         count(*) over (partition by owner_key) as rows_for_owner,
         count(*) over (partition by email) as rows_for_email
    from norm n
)
select d.row_no, d.owner_key, d.email, d.email_source, d.verification,
       o.id as owner_id, o.email as current_email, o.email_verified_at as current_verified_at,
       case
         when d.verification not in ('valid', 'invalid', 'risky', 'unknown') then 'bad_status'
         when d.email is null or d.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'bad_email'
         when d.email_source is null then 'missing_source'
         when o.id is null then 'unknown_owner'
         -- invalid / risky sobre el email actual verificado: se desmarca SIEMPRE, aunque la
         -- fila esté repetida (desmarcar solo reduce lo enviable; nunca es riesgoso).
         when d.verification in ('invalid', 'risky') and d.email = o.email
              and o.email_verified_at is not null then 'demoted'
         when d.rows_for_owner > 1 then 'duplicate_owner_in_file'
         when d.rows_for_email > 1 then 'duplicate_email_in_file'
         -- invalid / risky: nunca enviables
         when d.verification in ('invalid', 'risky') then 'rejected_' || d.verification
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

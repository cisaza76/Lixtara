-- Casos de scripts/sql/crm_import_contacts.sql (carga de emails del skip tracing).
-- Orden en run-crm-leads.sh: este archivo → scripts/sql/crm_import_contacts.sql →
-- crm-contacts-after.sql. Todo en UNA transacción que se revierte al final, igual que el
-- script de Python (las tablas temporales son `on commit drop`). NUNCA contra producción.
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- Propietarios ct-*: estado ANTES de la carga.
insert into public.crm_owners (owner_key, owner_type, registered_name, email, email_verified_at, source, collected_on)
values
  ('ct-1',  'LLC', 'CT 1',  null,                   null,  'test', current_date),
  ('ct-2',  'LLC', 'CT 2',  'old2@example.com',     now(), 'test', current_date),
  ('ct-3',  'LLC', 'CT 3',  'cur3@example.com',     now(), 'test', current_date),
  ('ct-4',  'LLC', 'CT 4',  'sup4@example.com',     now(), 'test', current_date),
  ('ct-5',  'LLC', 'CT 5',  null,                   null,  'test', current_date),
  ('ct-6',  'LLC', 'CT 6',  'u6@example.com',       null,  'test', current_date),
  ('ct-7',  'LLC', 'CT 7',  null,                   null,  'test', current_date),
  ('ct-8',  'LLC', 'CT 8',  null,                   null,  'test', current_date),
  ('ct-9',  'LLC', 'CT 9',  null,                   null,  'test', current_date),
  ('ct-10', 'LLC', 'CT 10', null,                   null,  'test', current_date),
  ('ct-11', 'LLC', 'CT 11', null,                   null,  'test', current_date),
  ('ct-12', 'LLC', 'CT 12', null,                   null,  'test', current_date),
  ('ct-13', 'LLC', 'CT 13', null,                   null,  'test', current_date),
  ('ct-14', 'LLC', 'CT 14', null,                   null,  'test', current_date),
  ('ct-15', 'LLC', 'CT 15', null,                   null,  'test', current_date),
  ('ct-16', 'LLC', 'CT 16', null,                   null,  'test', current_date),
  ('ct-17', 'LLC', 'CT 17', null,                   null,  'test', current_date);
insert into public.crm_suppression (email, reason, source) values
  ('sup4@example.com', 'unsubscribe', 'test'),
  ('blocked5@example.com', 'complaint', 'test');

-- El CSV, ya en la tabla temporal (como lo deja import_contacts.py).
create temp table stg_contacts (
  row_no int, owner_key text, email text, email_source text, verification text
) on commit drop;
insert into stg_contacts values
  (2,  'ct-1',     'new1@example.com',      'tracer', 'valid'),
  (3,  'ct-2',     'new2@example.com',      'tracer', 'unknown'),
  (4,  'ct-3',     'cur3@example.com',      'tracer', 'invalid'),
  (5,  'ct-4',     'new4@example.com',      'tracer', 'valid'),
  (6,  'ct-5',     'blocked5@example.com',  'tracer', 'valid'),
  (7,  'ct-6',     'u6@example.com',        'tracer', 'valid'),
  (8,  'ct-7',     'r7@example.com',        'tracer', 'risky'),
  (9,  'ct-8',     'old2@example.com',      'tracer', 'valid'),
  (10, 'ct-9',     'x9@example.com',        'tracer', 'valid'),
  (11, 'ct-9',     'y9@example.com',        'tracer', 'valid'),
  (12, 'ct-10',    'same@example.com',      'tracer', 'valid'),
  (13, 'ct-11',    'SAME@example.com',      'tracer', 'valid'),
  (14, 'no-such',  'ghost@example.com',     'tracer', 'valid'),
  (15, 'ct-12',    'e12@example.com',       'tracer', 'maybe'),
  (16, 'ct-13',    'not-an-email',          'tracer', 'valid'),
  (17, 'ct-14',    'e14@example.com',       '',       'valid'),
  (18, 'ct-15',    '  Mixed@Example.COM ',  'tracer', ' VALID '),
  (19, 'ct-16',    'i16@example.com',       'tracer', 'invalid'),
  (20, 'ct-17',    'un17@example.com',      'tracer', 'unknown'),
  -- ct-3 repetido con otro email: la fila invalid igual desmarca cur3
  (21, 'ct-3',     'other3@example.com',    'tracer', 'valid');

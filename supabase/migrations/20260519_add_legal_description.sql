-- Legal description pulled from Miami-Dade public records (item 18). Used
-- to auto-fill the DocuSign Listing Agreement template so the broker
-- doesn't have to type it manually before sending.
alter table public.properties
  add column if not exists legal_description text;

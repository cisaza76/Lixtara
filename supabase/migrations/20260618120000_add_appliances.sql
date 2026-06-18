-- Personal property: appliances the seller is including with the sale.
-- Stored as an array of canonical keys (see src/lib/appliances.ts). Feeds the
-- listing detail UI and the DocuSign "Personal Property" prefill.
alter table public.properties
  add column if not exists appliances text[] not null default '{}';

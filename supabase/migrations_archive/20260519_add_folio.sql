-- Miami-Dade folio number (Item 10). Stored on properties so the listing
-- review and admin pages can cross-reference public records. Nullable —
-- Florida properties outside Miami-Dade won't have one.
alter table public.properties
  add column if not exists folio text;

create index if not exists properties_folio_idx
  on public.properties (folio)
  where folio is not null;

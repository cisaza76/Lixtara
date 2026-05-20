-- Lixtara-owned signed-agreement records (F2.2 — DocuSign listing
-- agreements). Parallel to (not replacing) any pre-existing legacy
-- listing_agreements table from Lovable to avoid breaking its flow
-- during cutover.
create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  vendor text not null default 'docusign' check (vendor in ('docusign')),
  template_id text not null,
  envelope_id text unique,
  status text not null default 'pending' check (
    status in (
      'pending', 'sent', 'delivered', 'signed', 'completed',
      'declined', 'voided', 'expired'
    )
  ),
  signer_email text not null,
  signer_name text not null,
  signed_at timestamptz,
  declined_reason text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agreements_property_id_idx
  on public.agreements (property_id);
create index if not exists agreements_owner_id_idx
  on public.agreements (owner_id);
create index if not exists agreements_envelope_id_idx
  on public.agreements (envelope_id)
  where envelope_id is not null;
create index if not exists agreements_status_idx
  on public.agreements (status);

alter table public.agreements enable row level security;

drop policy if exists "own agreements select" on public.agreements;
create policy "own agreements select"
  on public.agreements for select
  using (auth.uid() = owner_id);

drop policy if exists "own agreements insert" on public.agreements;
create policy "own agreements insert"
  on public.agreements for insert
  with check (auth.uid() = owner_id);

-- Status flips happen via service-role only from the DocuSign Connect
-- webhook handler.

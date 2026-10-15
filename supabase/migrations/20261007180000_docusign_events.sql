-- Registro de solo-inserción de los eventos de DocuSign Connect (#137 b).
--
-- La auditoría del 2026-09-27 no pudo responderse desde nuestra base: el webhook no
-- guardaba lo que recibía. Esta tabla registra cada entrega: qué sobre, qué evento, cuándo,
-- el hash del cuerpo (no el cuerpo: trae nombres y emails), si la firma HMAC era válida,
-- si era un duplicado y en qué estado quedó el acuerdo.
--
-- Mismo patrón que property_status_history (#133): RLS activa, la broker/admin lee, nadie
-- de la API escribe. El webhook inserta con service_role, que solo tiene SELECT + INSERT:
-- ni siquiera él puede editar o borrar el registro.
--
-- Idempotente. Aplicar SOLO con sign-off del owner (`supabase db push`).

begin;

create table if not exists public.docusign_events (
  id                bigint generated always as identity primary key,
  envelope_id       text,
  event_type        text,
  received_at       timestamptz not null default now(),
  payload_sha256    text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  hmac_valid        boolean not null,
  duplicate         boolean not null default false,
  -- Estado de `agreements` tras procesar (null si no se procesó: duplicado, sobre
  -- desconocido o fallo al consultar DocuSign).
  resulting_status  text,
  note              text
);
create index if not exists docusign_events_envelope_idx
  on public.docusign_events (envelope_id, received_at desc);

alter table public.docusign_events enable row level security;
drop policy if exists "Brokers can view docusign events" on public.docusign_events;
create policy "Brokers can view docusign events" on public.docusign_events
  for select to authenticated using (public.is_admin_or_broker());

revoke all on public.docusign_events from public, anon, authenticated, service_role;
grant select on public.docusign_events to authenticated;
grant select, insert on public.docusign_events to service_role;

comment on table public.docusign_events is
  'Entregas de DocuSign Connect (solo inserción). Hash del cuerpo, no el cuerpo. #137.';

commit;

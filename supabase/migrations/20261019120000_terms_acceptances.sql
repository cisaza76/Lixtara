-- =============================================================================
-- terms_acceptances: prueba de cada aceptación de un texto legal (decisión del owner
-- 2026-10-16, opción 1).
--
-- Una fila por aceptación, de SOLO INSERCIÓN. Se escribe en estos momentos:
--   * 'terms'        — Términos y Privacidad al crear la cuenta (/sign-up y registro del
--                      paso 7); sin la casilla no se crea la cuenta (agregado 2026-10-18);
--   * 'terms_refund' — casilla de reembolso del paso 8, antes de pagar el plan en Stripe
--                      (lleva stripe_checkout_session_id);
--   * 'esign'        — aviso y consentimiento E-SIGN del paso 7, antes de abrir DocuSign;
--   * 'calls_sms'    — reservado para el consentimiento de llamadas/SMS (aún sin formulario).
-- Qué se guarda: versión del texto, idioma en que se mostró, SHA-256 del texto EXACTO
-- (los textos versionados viven en src/lib/legal/consents.ts y se pueden reconstruir), IP y
-- user agent (prueba para contracargos de Stripe y para el consentimiento de TCPA).
--
-- Escritura: SOLO el servidor (service_role). Lectura: el usuario sus propias filas;
-- admin/broker todas. Nadie puede editar ni borrar una fila (trigger), salvo las acciones
-- de las llaves foráneas: si se borra el usuario o la propiedad, su id queda en NULL y la
-- prueba se conserva [VERIFICAR con el abogado: retención frente a solicitudes de borrado].
-- Reversión: docs/superpowers/runbooks/rollback-20261019120000_terms_acceptances.sql
-- (versión 20261017120000 en el #203; renombrada a 20261019120000 al separarla, porque ya hay
-- migraciones aplicadas posteriores a esa fecha y `supabase db push` no la tomaría sin
-- --include-all). Aplicar SOLO con sign-off del owner.
-- =============================================================================

create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  document text not null check (document in ('terms', 'terms_refund', 'esign', 'calls_sms')),
  version text not null check (length(version) between 1 and 64),
  lang text not null check (lang in ('en', 'es')),
  consent_text_hash text not null check (consent_text_hash ~ '^[0-9a-f]{64}$'),
  context text not null check (context ~ '^[a-z0-9_]{1,40}$'),
  stripe_checkout_session_id text check (stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{1,200}$'),
  ip_address inet,
  user_agent text check (length(user_agent) <= 512),
  accepted_at timestamptz not null default now()
);

comment on table public.terms_acceptances is
  'Prueba de aceptación de textos legales (Términos y Privacidad al crear la cuenta, casilla de reembolso, E-SIGN, llamadas/SMS). Solo inserción desde el servidor; texto exacto reconstruible por versión + idioma + hash (src/lib/legal/consents.ts).';

create index if not exists terms_acceptances_user_idx on public.terms_acceptances (user_id, accepted_at desc);
create index if not exists terms_acceptances_property_idx on public.terms_acceptances (property_id) where property_id is not null;
create index if not exists terms_acceptances_session_idx on public.terms_acceptances (stripe_checkout_session_id) where stripe_checkout_session_id is not null;

-- Solo inserción: ningún UPDATE ni DELETE, salvo poner en NULL user_id / property_id
-- (lo que hacen las llaves foráneas al borrar el usuario o la propiedad).
create or replace function public.terms_acceptances_append_only()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'terms_acceptances is append-only' using errcode = '42501';
  end if;
  if (new.id, new.document, new.version, new.lang, new.consent_text_hash, new.context,
      new.stripe_checkout_session_id, new.ip_address, new.user_agent, new.accepted_at)
     is distinct from
     (old.id, old.document, old.version, old.lang, old.consent_text_hash, old.context,
      old.stripe_checkout_session_id, old.ip_address, old.user_agent, old.accepted_at)
     or (new.user_id is not null and new.user_id is distinct from old.user_id)
     or (new.property_id is not null and new.property_id is distinct from old.property_id) then
    raise exception 'terms_acceptances is append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists terms_acceptances_append_only on public.terms_acceptances;
create trigger terms_acceptances_append_only
  before update or delete on public.terms_acceptances
  for each row execute function public.terms_acceptances_append_only();

alter table public.terms_acceptances enable row level security;

drop policy if exists "terms_acceptances own read" on public.terms_acceptances;
create policy "terms_acceptances own read" on public.terms_acceptances
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "terms_acceptances staff read" on public.terms_acceptances;
create policy "terms_acceptances staff read" on public.terms_acceptances
  for select to authenticated using (public.is_admin_or_broker());

-- Supabase da ALL a anon/authenticated en tablas nuevas: solo queda SELECT (con RLS).
revoke all on public.terms_acceptances from anon, authenticated;
grant select on public.terms_acceptances to authenticated;
grant all on public.terms_acceptances to service_role;

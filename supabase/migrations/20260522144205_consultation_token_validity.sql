-- Consultation hour tokens expire 90 days after purchase.
alter table public.consultation_tokens
  add column if not exists expires_at timestamptz
    default (now() + interval '90 days');

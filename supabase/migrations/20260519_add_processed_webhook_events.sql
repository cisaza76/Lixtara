-- Idempotency ledger for inbound provider webhooks (go-live hardening).
-- Stripe (and others) can deliver the same event more than once; without a
-- dedup guard that means duplicate emails and repeated side effects. We claim
-- each event by (vendor, event_id) before processing — the unique constraint
-- makes a duplicate delivery a no-op and serializes concurrent retries.
--
-- Apply via Supabase Dashboard → SQL Editor → New query → paste + run.
-- (No automated migration pipeline yet — see CLAUDE.md Phase status.)

create table if not exists public.processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,            -- 'stripe' | 'docusign' | 'kiri'
  event_id text not null,          -- provider's unique event id (Stripe evt_...)
  event_type text,                 -- retained for debugging / auditing
  processed_at timestamptz not null default now(),
  unique (vendor, event_id)
);

-- Only the service-role client (which bypasses RLS) reads/writes this table.
-- RLS on + no policies = anon / authenticated have no access.
alter table public.processed_webhook_events enable row level security;

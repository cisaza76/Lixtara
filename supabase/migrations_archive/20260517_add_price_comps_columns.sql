-- Columns for Rentcast sale comparables on properties.
-- Populated by lib/rentcast.ts on Step 3 entry of the listing form.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS price_comps jsonb,
  ADD COLUMN IF NOT EXISTS price_estimate_low integer,
  ADD COLUMN IF NOT EXISTS price_estimate_high integer,
  ADD COLUMN IF NOT EXISTS price_comps_fetched_at timestamptz;

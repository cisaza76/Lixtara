-- Add pricing_tier column to public.properties for the seller flow Step 2
-- (Plan). Stores the PricingTierId enum from src/lib/pricing-tiers.ts.
-- Nullable: a draft listing may not have picked a tier yet.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS pricing_tier text;

-- Constraint: limit to the known tier IDs. Drop-and-recreate so this
-- migration is idempotent if applied twice.
ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_pricing_tier_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_pricing_tier_check
  CHECK (pricing_tier IS NULL OR pricing_tier IN ('essentials', 'pro', 'concierge'));

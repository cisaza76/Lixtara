-- Extended property fields per Camilo's spec for Step 3 (Details) and
-- Step 5 (Photos copyright disclaimer). All nullable / default false so
-- existing rows are unaffected.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS parking_spaces integer,
  ADD COLUMN IF NOT EXISTS hoa_fee integer,
  ADD COLUMN IF NOT EXISTS tax_annual_amount integer,
  ADD COLUMN IF NOT EXISTS has_pool boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cash_only boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS as_is_sale boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS flood_zone text,
  ADD COLUMN IF NOT EXISTS occupancy_status text
    CHECK (occupancy_status IS NULL OR occupancy_status IN ('vacant', 'owner_occupied', 'tenant_occupied')),
  ADD COLUMN IF NOT EXISTS show_phone_on_portals boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS photos_rights_confirmed boolean DEFAULT false;

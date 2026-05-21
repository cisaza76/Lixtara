-- Tenant / lease details captured at listing step 3 when the property is
-- occupied by a tenant (occupancy_status = 'tenant_occupied').
alter table public.properties
  add column if not exists monthly_rent numeric(10,2),
  add column if not exists lease_end_date date,
  add column if not exists tenant_cooperation text
    check (tenant_cooperation in ('cooperative', 'advance_notice', 'difficult')),
  add column if not exists tenant_notes text;

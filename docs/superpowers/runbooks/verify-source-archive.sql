-- F4.6 Stage E — READ-ONLY verification queries for Source Asset Archive runs.
-- NOT a migration (lives in runbooks/, never in supabase/migrations/). No credentials here.
-- Every statement below is a SELECT — zero writes, zero DDL, zero Storage access.
--
-- Usage (psql): supply the run under inspection as a psql variable, then paste a block:
--   \set runid 'run-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
-- Placeholders are :'runid' (string) — psql substitutes them. Do NOT run against production
-- outside the runbook procedure (docs/superpowers/runbooks/2026-07-25-source-asset-archive.md).
--
-- Archive is SOFT delete: lifecycle='archived' + archived_at. Rows and Storage objects remain.

-- ── Q1. Assets archived by this run (via its audit events) ─────────────────────────────────
select a.id, a.listing_id, a.owner_id, a.lifecycle, a.archived_at, a.bytes, a.storage_path
  from public.activity_log e
  join public.assets a on a.id = (e.metadata->>'assetId')::uuid
 where e.action_type = 'creative_studio.source_asset_archived'
   and e.metadata->>'runId' = :'runid'
 order by a.listing_id, a.id;

-- ── Q2. Audit event count for this run (compare against the apply report's `archived`) ─────
select count(*) as audit_events
  from public.activity_log
 where action_type = 'creative_studio.source_asset_archived'
   and metadata->>'runId' = :'runid';

-- ── Q3. Duplicate audit events (expect 0 rows — the partial unique index forbids them) ─────
select metadata->>'assetId' as asset_id, count(*) as events
  from public.activity_log
 where action_type = 'creative_studio.source_asset_archived'
 group by metadata->>'assetId'
having count(*) > 1;

-- ── Q4. Archived source assets WITHOUT any archive audit (expect 0 rows; repairable) ───────
select a.id, a.listing_id, a.owner_id, a.archived_at
  from public.assets a
 where a.kind = 'video' and a.source_type = 'seller_upload' and a.lifecycle = 'archived'
   and not exists (
     select 1 from public.activity_log e
      where e.action_type = 'creative_studio.source_asset_archived'
        and e.metadata->>'assetId' = a.id::text
   );

-- ── Q5. Audit events whose asset is NOT archived (expected only after a restore) ───────────
select e.metadata->>'assetId' as asset_id, e.metadata->>'runId' as run_id, a.lifecycle
  from public.activity_log e
  left join public.assets a on a.id = (e.metadata->>'assetId')::uuid
 where e.action_type = 'creative_studio.source_asset_archived'
   and (a.lifecycle is distinct from 'archived');

-- ── Q6. lifecycle='archived' with NULL archived_at (expect 0 rows — flip sets both) ────────
select id, listing_id, owner_id
  from public.assets
 where lifecycle = 'archived' and archived_at is null;

-- ── Q7. archived_at present on a NON-archived asset (expect 0 rows outside restores;
--        the restore procedure clears archived_at) ──────────────────────────────────────────
select id, listing_id, owner_id, lifecycle, archived_at
  from public.assets
 where lifecycle <> 'archived' and archived_at is not null;

-- ── Q8. owner/listing mismatch between the asset row and the audit metadata (expect 0) ─────
select e.id as event_id, e.metadata->>'assetId' as asset_id,
       a.owner_id as asset_owner, e.metadata->>'ownerId' as audit_owner,
       a.listing_id as asset_listing, e.metadata->>'listingId' as audit_listing
  from public.activity_log e
  join public.assets a on a.id = (e.metadata->>'assetId')::uuid
 where e.action_type = 'creative_studio.source_asset_archived'
   and (a.owner_id::text <> e.metadata->>'ownerId' or a.listing_id::text <> e.metadata->>'listingId');

-- ── Q9. INVARIANT ALARM: an archived asset that is currently the listing's CURRENT source.
--        (Read-only VERIFICATION mirror of resolveVideoSource — newest eligible per
--        listing+owner. This query never decides anything; the authority remains
--        src/lib/video-engine/resolve-video-source.ts. Expect 0 rows; >0 → ESCALATE.) ───────
with current_per_listing as (
  select distinct on (listing_id, owner_id) id
    from public.assets
   where kind = 'video' and source_type = 'seller_upload'
   order by listing_id, owner_id, created_at desc
)
select a.id, a.listing_id, a.owner_id, a.archived_at
  from public.assets a
  join current_per_listing c on c.id = a.id
 where a.lifecycle = 'archived';

-- ── Q10. Per-run summary proxy (full per-outcome detail lives in the runner's JSON report;
--         this cross-checks the DB side: events vs archived rows for this run) ──────────────
select
  (select count(*) from public.activity_log
    where action_type = 'creative_studio.source_asset_archived' and metadata->>'runId' = :'runid') as audit_events,
  (select count(*) from public.activity_log e join public.assets a on a.id = (e.metadata->>'assetId')::uuid
    where e.action_type = 'creative_studio.source_asset_archived' and e.metadata->>'runId' = :'runid'
      and a.lifecycle = 'archived') as assets_still_archived;

-- ── Q11. Hard-delete detector: audit events whose asset ROW no longer exists (expect 0 —
--         archive never deletes; a row here is evidence of an out-of-band DELETE → ESCALATE) ─
select e.metadata->>'assetId' as missing_asset_id, e.metadata->>'runId' as run_id, e.created_at
  from public.activity_log e
 where e.action_type = 'creative_studio.source_asset_archived'
   and not exists (select 1 from public.assets a where a.id = (e.metadata->>'assetId')::uuid);

-- ── Q12. Storage unchanged (as far as the DB can attest): archived assets of this run whose
--         Storage object is MISSING (expect 0 rows — archive never touches Storage) ─────────
select a.id, a.storage_bucket, a.storage_path
  from public.activity_log e
  join public.assets a on a.id = (e.metadata->>'assetId')::uuid
 where e.action_type = 'creative_studio.source_asset_archived'
   and e.metadata->>'runId' = :'runid'
   and not exists (
     select 1 from storage.objects o
      where o.bucket_id = a.storage_bucket and o.name = a.storage_path
   );

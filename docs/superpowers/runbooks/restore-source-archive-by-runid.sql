-- F4.6 Stage E — MANUAL restore of Source Assets archived by ONE run (rollback-by-runId).
-- NOT a migration (lives in runbooks/, never in supabase/migrations/). No credentials here.
--
-- PRINCIPLES
-- - Restore makes NO decisions: it operates exclusively on the explicit evidence recorded by
--   the archive audit events (runId, assetId, ownerId, listingId, prevLifecycle, archivedAt).
--   It never recalculates current or retention, never calls the engine, never picks assets by
--   age, never infers prevLifecycle, never touches Storage, never restores another run's assets.
-- - The authoritative identifier is runId. No time-range criteria.
-- - After restore, `resolveVideoSource` re-decides the current under its normal rules — this
--   script NEVER forces any asset to be current.
-- - The ORIGINAL archive audit events are preserved untouched (append-only evidence). A NEW
--   `creative_studio.source_asset_restored` event is emitted per restored asset, in the SAME
--   transaction as the flip.
--
-- SAFETY GATES (all three are required to actually write):
--   1. The whole script runs inside BEGIN … and ends with ROLLBACK by default.
--   2. The UPDATE is inert until you consciously set:  \set confirm RESTORE-CONFIRMED
--   3. Nothing persists until you consciously replace the final ROLLBACK with COMMIT.
--
-- Usage (psql):
--   \set runid          'run-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'   -- the archive run to undo (REQUIRED)
--   \set restore_runid  'restore-yyyy-mm-dd-<operator-ticket>'        -- this restore's own correlation id (REQUIRED)
--   \set restore_reason 'why this restore is happening'               -- REQUIRED
--   \set confirm        'NO'                                          -- change to RESTORE-CONFIRMED only after the preview

begin;

-- ── STEP 1 — PREVIEW: what WOULD be restored (run this, read every row) ────────────────────
with events as (
  select e.id as event_id,
         (e.metadata->>'assetId')::uuid  as asset_id,
         (e.metadata->>'ownerId')::uuid  as event_owner_id,
         (e.metadata->>'listingId')::uuid as event_listing_id,
         e.metadata->>'prevLifecycle'    as prev_lifecycle,
         (e.metadata->>'archivedAt')::timestamptz as event_archived_at,
         count(*) over (partition by (e.metadata->>'assetId')) as events_for_asset
    from public.activity_log e
   where e.action_type = 'creative_studio.source_asset_archived'
     and e.metadata->>'runId' = :'runid'
)
select ev.asset_id, ev.prev_lifecycle, ev.event_archived_at,
       a.lifecycle as current_lifecycle, a.archived_at as current_archived_at,
       case
         when ev.events_for_asset > 1 then 'EXCLUDED: duplicate/ambiguous audit for this asset'
         when a.id is null then 'EXCLUDED: asset row no longer exists (ESCALATE — possible hard delete)'
         when ev.prev_lifecycle is null or ev.prev_lifecycle = '' then 'EXCLUDED: missing prevLifecycle (never invented)'
         when ev.prev_lifecycle not in ('draft','ready_for_review','approved','rejected')
           then 'EXCLUDED: prevLifecycle not a valid restore target'
         when a.owner_id  is distinct from ev.event_owner_id  then 'EXCLUDED: ownerId mismatch (ESCALATE)'
         when a.listing_id is distinct from ev.event_listing_id then 'EXCLUDED: listingId mismatch (ESCALATE)'
         when a.lifecycle <> 'archived' then 'EXCLUDED: asset is no longer archived'
         when a.archived_at is null or a.archived_at <> ev.event_archived_at
           then 'EXCLUDED: archived_at does not match the event (asset modified after archive)'
         else 'ELIGIBLE FOR RESTORE'
       end as verdict
  from events ev
  left join public.assets a on a.id = ev.asset_id
 order by verdict, ev.asset_id;

-- Review the preview. Expected: every row is either ELIGIBLE or has an explained exclusion.
-- Any ESCALATE verdict → STOP here (leave the trailing ROLLBACK in place) and follow the
-- runbook's escalation section. Only then:  \set confirm RESTORE-CONFIRMED

-- ── STEP 2 — RESTORE (inert until :confirm is set; guarded row-by-row exactly as previewed) ─
with events as (
  select (e.metadata->>'assetId')::uuid  as asset_id,
         (e.metadata->>'ownerId')::uuid  as event_owner_id,
         (e.metadata->>'listingId')::uuid as event_listing_id,
         e.metadata->>'prevLifecycle'    as prev_lifecycle,
         (e.metadata->>'archivedAt')::timestamptz as event_archived_at,
         count(*) over (partition by (e.metadata->>'assetId')) as events_for_asset
    from public.activity_log e
   where e.action_type = 'creative_studio.source_asset_archived'
     and e.metadata->>'runId' = :'runid'
),
restored as (
  update public.assets a
     set lifecycle  = ev.prev_lifecycle,
         archived_at = null
    from events ev
   where :'confirm' = 'RESTORE-CONFIRMED'            -- conscious-confirmation gate
     and length(:'restore_runid') > 0                 -- restore correlation id is REQUIRED
     and length(:'restore_reason') > 0                -- restore reason is REQUIRED
     and a.id = ev.asset_id
     and ev.events_for_asset = 1                      -- ambiguous/duplicated events are excluded
     and ev.prev_lifecycle in ('draft','ready_for_review','approved','rejected')
     and a.owner_id  = ev.event_owner_id              -- owner must match the evidence
     and a.listing_id = ev.event_listing_id           -- listing must match the evidence
     and a.lifecycle = 'archived'                     -- only still-archived assets
     and a.archived_at = ev.event_archived_at         -- unmodified since the archive flip
  returning a.id, a.listing_id, a.owner_id, a.lifecycle as restored_lifecycle
)
insert into public.activity_log (user_id, property_id, action_type, description, metadata)
select r.owner_id, r.listing_id,
       'creative_studio.source_asset_restored',
       'Source video restored from archive (manual runbook, correlated by runId)',
       jsonb_build_object(
         'assetId',            r.id,
         'listingId',          r.listing_id,
         'ownerId',            r.owner_id,
         'sourceArchiveRunId', :'runid',
         'restoreRunId',       :'restore_runid',
         'restoredLifecycle',  r.restored_lifecycle,
         'restoredAt',         now(),
         'reason',             :'restore_reason'
       )
  from restored;
-- (single statement: the flip and its restore-audit insert are atomic; the ORIGINAL archive
--  events are never updated or removed)

-- ── STEP 3 — IN-TRANSACTION VERIFICATION (before deciding COMMIT vs ROLLBACK) ──────────────
-- 3a. Assets of this run still archived (expect: only the previewed EXCLUDED ones):
select a.id, a.lifecycle, a.archived_at
  from public.activity_log e
  join public.assets a on a.id = (e.metadata->>'assetId')::uuid
 where e.action_type = 'creative_studio.source_asset_archived'
   and e.metadata->>'runId' = :'runid'
   and a.lifecycle = 'archived';

-- 3b. Restore audit events emitted in this transaction (expect: one per restored asset):
select metadata->>'assetId' as asset_id, metadata->>'restoredLifecycle' as restored_to
  from public.activity_log
 where action_type = 'creative_studio.source_asset_restored'
   and metadata->>'restoreRunId' = :'restore_runid';

-- ── STEP 4 — DECIDE ────────────────────────────────────────────────────────────────────────
-- Default is ROLLBACK (nothing persists). After verifying 3a/3b, consciously replace it:
rollback;
-- commit;   -- ← uncomment (and remove the rollback above) ONLY after Step 3 verification

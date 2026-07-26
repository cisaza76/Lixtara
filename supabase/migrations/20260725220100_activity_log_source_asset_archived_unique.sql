-- F4.6 Stage C — idempotent + concurrency-safe audit for Source Asset archive (design §5/§8.2).
--
-- At most ONE 'creative_studio.source_asset_archived' row per
-- (user_id, property_id, metadata->>'assetId'): a repeated OR concurrent archive of the same
-- asset converges on a single durable audit event instead of duplicating it. A losing
-- concurrent insert hits 23505, which the ensure-audit helper (F4.1 pattern,
-- src/lib/creative-studio/source-archive-audit.ts) treats as "already ensured".
--
-- Partial (scoped to this action_type) so it never constrains any other activity_log row.
-- Mirrors activity_log_video_source_uploaded_unique (F4.1) exactly. No new table.
--
-- AUTHORED, NOT APPLIED. Apply with owner sign-off only (supabase db push).
create unique index if not exists activity_log_source_asset_archived_unique
  on public.activity_log (user_id, property_id, ((metadata->>'assetId')))
  where action_type = 'creative_studio.source_asset_archived';

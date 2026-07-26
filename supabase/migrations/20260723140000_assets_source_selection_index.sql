-- F4.1 — index supporting F3's uploaded_video source resolution
-- (worker-deps/uploaded-video-pipeline `resolveVideoSource`, which lists a listing's assets
-- and filters kind='video' + source_type='seller_upload'). Additive, idempotent.
--
-- AUTHORED, NOT APPLIED. Depends on the base Creative Studio migration
-- (20260715171914_creative_studio_video.sql, which creates public.assets) — that one is also
-- authored-and-pending. Apply BOTH, in order, only after owner sign-off (see the F4.1 owner
-- runbook). Idempotency of the Source Asset itself needs no new constraint: the existing
-- `assets_source_unique (source_type, source_id) where source_id is not null` already prevents
-- duplicate seller_upload sources.
create index if not exists assets_listing_kind_source_idx
  on public.assets (listing_id, kind, source_type);

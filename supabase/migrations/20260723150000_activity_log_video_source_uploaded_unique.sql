-- F4.1 (correction 1) — make the seller source-video upload audit event idempotent +
-- concurrency-safe. At most ONE 'creative_studio.video_source_uploaded' row per
-- (user_id, property_id, metadata->>'uploadId'), so a repeated OR concurrent /complete
-- converges on a single durable event instead of duplicating it (a losing concurrent insert
-- hits 23505, which the app's ensure-audit helper treats as "already ensured").
--
-- Partial (scoped to this action_type) so it never constrains any other activity_log row.
-- AUTHORED, NOT APPLIED. activity_log already exists (baseline); apply with owner sign-off.
-- Without this index applied, sequential retries are still idempotent (find-then-insert), but
-- two TRULY concurrent /complete calls could each miss and both insert — this index closes
-- that race.
create unique index if not exists activity_log_video_source_uploaded_unique
  on public.activity_log (user_id, property_id, ((metadata->>'uploadId')))
  where action_type = 'creative_studio.video_source_uploaded';

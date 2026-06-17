-- Generalize tour_jobs beyond KIRI so the pluggable TourProcessor can use it
-- for any engine (Veo "Living Listing" video, future Replicate/Modal 3DGS, ...).
--
-- The original table hard-coded vendor='kiri' (CHECK) and only had KIRI-shaped
-- columns. Relax the vendor constraint and add engine-neutral columns. The
-- status CHECK already allows processing/ready/failed, so it is left as-is.

alter table public.tour_jobs drop constraint if exists tour_jobs_vendor_check;

alter table public.tour_jobs
  -- what kind of tour this job produces
  add column if not exists tour_kind text not null default 'gaussian_splat'
    check (tour_kind in ('gaussian_splat', 'video')),
  -- the processor's own job/operation id (replaces the kiri-only kiri_task_id)
  add column if not exists vendor_job_id text,
  -- storage path of the produced asset (video mp4 or .ply/zip), engine-neutral
  add column if not exists output_path text;

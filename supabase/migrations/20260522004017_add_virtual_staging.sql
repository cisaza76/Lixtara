-- Virtual staging: AI-generated staged versions of empty-room photos, moderated
-- by the broker before they show on the public listing.
alter table public.property_photos
  add column if not exists is_staged boolean not null default false,
  add column if not exists original_photo_id uuid
    references public.property_photos(id) on delete set null,
  add column if not exists staging_status text
    check (staging_status in ('pending', 'approved', 'rejected'));

create index if not exists property_photos_staged_idx
  on public.property_photos (is_staged, staging_status);

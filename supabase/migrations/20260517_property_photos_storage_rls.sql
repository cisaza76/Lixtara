-- RLS for the property-photos storage bucket (already exists, public read).
-- Sellers upload their own listing photos; deletion limited to owner.
-- Folder structure enforced by policy: {auth.uid()}/{property_id}/{filename}.

DROP POLICY IF EXISTS "users_upload_own_property_photos" ON storage.objects;
CREATE POLICY "users_upload_own_property_photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'property-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "users_delete_own_property_photos" ON storage.objects;
CREATE POLICY "users_delete_own_property_photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'property-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- SELECT is allowed for everyone via the public-bucket flag (no policy
-- needed). Buckets created with public=true bypass storage.objects RLS
-- when accessed via the public URL endpoint.

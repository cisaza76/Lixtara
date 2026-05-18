import { createClient } from "@/lib/supabase/server";

const BUCKET = "property-photos";
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface UploadedPhoto {
  url: string;
  storagePath: string;
}

/**
 * Upload one image file to the property-photos bucket under
 * `{user_id}/{property_id}/{timestamp}-{nanoid}.{ext}`. Returns the public
 * URL + the storage path (for deletion later).
 */
export async function uploadPropertyPhoto(
  userId: string,
  propertyId: string,
  file: File,
): Promise<UploadedPhoto> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(`unsupported file type: ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`file too large: ${file.size} bytes`);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const path = `${userId}/${propertyId}/${filename}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, storagePath: path };
}

/**
 * Delete a storage object by path. Use the storage path from
 * property_photos.url (extracted in the caller). Idempotent — non-existent
 * paths return success.
 */
export async function deletePropertyPhoto(storagePath: string): Promise<void> {
  const supabase = await createClient();
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

/**
 * Extract the storage path from a public Supabase Storage URL.
 * Public URLs look like:
 *   https://<project>.supabase.co/storage/v1/object/public/property-photos/<path>
 */
export function storagePathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  return url.slice(i + marker.length);
}

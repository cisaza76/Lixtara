// Map property_photos rows to Assets and enforce a minimum usable count.
// (The route loads rows via the supabase client; this stays pure + testable.)
import type { Asset } from "@/lib/media-intelligence/types";

export const MIN_PHOTOS = 3;

export interface PhotoRow {
  id: string;
  url: string | null;
}

export class TooFewPhotosError extends Error {
  constructor(readonly have: number) {
    super(`need at least ${MIN_PHOTOS} usable photos, have ${have}`);
    this.name = "TooFewPhotosError";
  }
}

export function toAssets(rows: PhotoRow[]): Asset[] {
  const assets = rows
    .filter((r): r is { id: string; url: string } => Boolean(r.url))
    .map((r) => ({ photoId: r.id, url: r.url }));
  if (assets.length < MIN_PHOTOS) throw new TooFewPhotosError(assets.length);
  return assets;
}

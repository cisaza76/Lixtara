// F4.2 — Job Routing. The ONE place that decides, per listing, whether a video job runs the
// uploaded_video or photo_slideshow strategy. Backend-only: it reads NOTHING from the client
// and reuses F3's `resolveVideoSource` UNCHANGED. The decision runs once per produce and
// dispatches into the SAME F3 pipeline (no second pipeline, no duplicated logic).
import type { Asset } from "@/lib/assets/types";
import type { SourceStrategy } from "@/lib/video-engine/worker-deps"; // type-only (erased) — no runtime cycle

// A source asset is usable for routing only if it is a seller-uploaded video with a real
// storage location. A missing/malformed asset is NOT usable → the router falls back to
// photo_slideshow rather than breaking the pipeline.
export function isUsableSourceVideo(asset: Asset | null | undefined): boolean {
  return (
    !!asset &&
    asset.kind === "video" &&
    asset.sourceType === "seller_upload" &&
    typeof asset.storagePath === "string" &&
    asset.storagePath.length > 0 &&
    typeof asset.storageBucket === "string" &&
    asset.storageBucket.length > 0
  );
}

// Per-listing decision. A valid Source Asset → uploaded_video; otherwise photo_slideshow.
// A resolver error is swallowed to photo_slideshow so a lookup failure never breaks the job.
// The feature flag is handled UPSTREAM (this is only invoked when auto-routing is active);
// keeping it flag-agnostic makes it a pure, directly-testable decision.
export async function decideSourceStrategy(
  resolveVideoSource: ((listingId: string, ownerId: string) => Promise<Asset | null>) | undefined,
  listingId: string,
  ownerId: string,
): Promise<SourceStrategy> {
  if (!resolveVideoSource) return "photo_slideshow";
  let source: Asset | null = null;
  try {
    source = await resolveVideoSource(listingId, ownerId);
  } catch {
    return "photo_slideshow"; // a resolver failure must not break routing
  }
  return isUsableSourceVideo(source) ? "uploaded_video" : "photo_slideshow";
}

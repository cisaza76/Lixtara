// F4.3 — pure mapping from a seller Source-Video Asset to the SELLER-FACING DTO the UI
// reads. No I/O, no Supabase, no React. Mirrors the seller-video-status pattern. The DTO
// deliberately exposes only safe, seller-comprehensible fields — NEVER storagePath, bucket,
// provenance, sourceId, or any internal Asset field, and never a signed URL/token.
import type { Asset } from "@/lib/assets/types";

// Seller-facing status. Internal `lifecycle` jargon (e.g. "draft") is never surfaced raw.
export type SellerSourceStatus = "uploaded" | "pending_validation";

export interface SellerSourceInfo {
  assetId: string;
  fileName?: string; // not stored on the Asset today → omitted; reserved for a future field
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string; // ISO passthrough from asset.createdAt
  status: SellerSourceStatus;
}

export interface SellerSourceDto {
  exists: boolean;
  source?: SellerSourceInfo;
}

// A freshly-uploaded source sits at lifecycle "draft" (F4.1) — received + available but not
// yet technically validated → "pending_validation". Anything past that (a future
// promotion) reads as "uploaded". "archived" never reaches here (deferred delete is out of
// F4.3 scope).
export function sourceStatusFromLifecycle(lifecycle: string): SellerSourceStatus {
  return lifecycle === "draft" ? "pending_validation" : "uploaded";
}

export function toSellerSourceDto(asset: Asset | null): SellerSourceDto {
  if (!asset) return { exists: false };
  return {
    exists: true,
    source: {
      assetId: asset.id,
      sizeBytes: asset.bytes,
      mimeType: asset.mime,
      uploadedAt: asset.createdAt,
      status: sourceStatusFromLifecycle(asset.lifecycle),
    },
  };
}

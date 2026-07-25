// Pure mapping from the internal Creative Job state machine (8 technical render states,
// see @/lib/creative-jobs/states) to the 4 seller-facing states the Creative Studio panel
// displays, plus derivation of display meta from a finished video Asset. No I/O, no
// Supabase, no React — consumed by a later status API route and React panel.
import type { CreativeJobState } from "@/lib/creative-jobs/states";
import type { Asset } from "@/lib/assets/types";

export type SellerVideoState = "idle" | "creating" | "completed" | "failed";

export interface SellerVideoMeta {
  createdAt: string; // ISO passthrough from asset.createdAt
  durationSeconds: number | null;
  resolutionLabel: string | null; // e.g. "1080p"
  photoCount: number | null;
}

export interface SellerVideoStatusDto {
  state: SellerVideoState;
  video: { previewUrl: string; downloadUrl: string; meta: SellerVideoMeta } | null;
}

// Exhaustive switch with a `never` default: a new CreativeJobState value that isn't
// handled here fails to compile rather than silently falling through to some default
// seller state.
export function mapJobStateToSeller(state: CreativeJobState | null): SellerVideoState {
  if (state === null) return "idle";

  switch (state) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "idle"; // seller can create again
    case "queued":
    case "running":
    case "rendering":
    case "qa":
    case "uploading":
      return "creating";
    default: {
      const _exhaustive: never = state;
      throw new Error(`mapJobStateToSeller: unhandled CreativeJobState ${String(_exhaustive)}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Defensive extraction: `asset.qa` is typed `unknown` (opaque Media QA Agent verdict) —
// never cast blindly. Anything not shaped as expected degrades to `null`, never throws.
export function deriveVideoMeta(
  asset: Pick<Asset, "createdAt" | "qa" | "provenance">,
): SellerVideoMeta {
  const qa = asset.qa;

  let durationSeconds: number | null = null;
  let resolutionLabel: string | null = null;

  if (isRecord(qa)) {
    if (typeof qa.durationSec === "number") {
      durationSeconds = qa.durationSec;
    }
    if (typeof qa.height === "number") {
      resolutionLabel = `${qa.height}p`;
    }
  }

  const sourceAssetIds = asset.provenance?.sourceAssetIds;
  const photoCount = Array.isArray(sourceAssetIds) ? sourceAssetIds.length : null;

  return {
    createdAt: asset.createdAt,
    durationSeconds,
    resolutionLabel,
    photoCount,
  };
}

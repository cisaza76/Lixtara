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
  // UX 5C — present ONLY on completed: which strategy produced the video (chip copy).
  madeFrom?: "photos" | "uploaded_video";
  // UX 5C — present ONLY on failed: the closed seller-facing failure treatment.
  failure?: SellerFailureDto;
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

// ---- UX 5C (approved 2026-07-28) — seller-facing failure derivation -----------------
// The visible failure treatment rests on EXPLICIT error properties (seller-failure-kind:
// sellerFacing flag → source action; ERROR_CLASS retriable → retry), plus the two
// operational inputs the route provides: remaining capacity and the repetition rule.
import {
  referenceCodeFromTraceId,
  sellerFailureKindFor,
  type SellerFailureKind,
} from "@/lib/creative-studio/seller-failure-kind";

export interface SellerFailureDto {
  kind: SellerFailureKind;
  reference: string | null; // 8-hex support handle; failure states only
  canRetry: boolean; // capacity remains AND the kind makes a retry legitimately useful
  supportPrimary: boolean; // support becomes the primary CTA
}

export function deriveSellerFailure(input: {
  errorCode: string | null;
  traceId: string | null;
  remainingGenerations: number;
  isRepeatEquivalentFailure: boolean;
}): SellerFailureDto {
  const kind = sellerFailureKindFor(input.errorCode);
  const hasCapacity = input.remainingGenerations > 0;
  const canRetry = kind === "technical_retryable" && hasCapacity;
  const supportPrimary =
    kind === "technical_support" ||
    (kind === "technical_retryable" && (input.isRepeatEquivalentFailure || !hasCapacity));
  return {
    kind,
    reference: referenceCodeFromTraceId(input.traceId),
    canRetry,
    supportPrimary,
  };
}

export interface FailureIdentity {
  errorCode: string | null;
  strategy: string | null;
  sourceAssetId: string | null;
}

// Approved repetition rule: two failures are equivalent only for the SAME listing
// (implied by the caller's scope), SAME strategy, SAME source asset (when one exists),
// and the same seller-facing kind OR the same error code. Two arbitrary historical
// failures are never enough.
export function isEquivalentFailure(a: FailureIdentity, b: FailureIdentity): boolean {
  if ((a.strategy ?? null) !== (b.strategy ?? null)) return false;
  if ((a.sourceAssetId ?? null) !== (b.sourceAssetId ?? null)) return false;
  if (a.errorCode === b.errorCode) return true;
  return sellerFailureKindFor(a.errorCode) === sellerFailureKindFor(b.errorCode);
}

// Chip source: which strategy produced the finished video. Legacy assets predate the
// provenance field → default to the original photos framing.
export function madeFromStrategy(sourceStrategy: string | null | undefined): "photos" | "uploaded_video" {
  return sourceStrategy === "uploaded_video" ? "uploaded_video" : "photos";
}

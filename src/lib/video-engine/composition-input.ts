// F3-A Step 1 — the discriminated CompositionInput contract: exactly what the (later,
// generalized) ListingVideoComposition receives, per source strategy. Dependency-free
// pure types — deliberately NOT placed in src/remotion in this step (no Remotion file is
// touched), and NOT imported by any composition yet, so it is a pure contract with zero
// behavior change. A later, separately-authorized step relocates/wires it into the
// composition and gives it a zod schema.
//
// Invariant the two-axis design rests on: the composition NEVER resolves layout, aspect,
// rotation, letterboxing, or blurred background. For uploaded_video, `videoSrc` already
// points at a file NORMALIZED to the output frame (1920×1080) upstream (F2-D Strategy C);
// the composition just plays it. That is why `objectFit` is not part of this contract.

export interface CardBrand {
  name: string;
}
export interface CardCta {
  text: string;
}
export interface CardBadge {
  text: string;
}
export interface CompositionProperty {
  addressLine: string;
  name?: string;
}

export interface PhotoSlideshowCompositionInput {
  source: "photo_slideshow";
  property: CompositionProperty;
  priceLabel: string;
  photos: { url: string; roomLabel?: string }[];
  brand: CardBrand;
  cta: CardCta;
  badge: CardBadge | null;
}

export interface UploadedVideoCompositionInput {
  source: "uploaded_video";
  property: CompositionProperty;
  priceLabel: string;
  // Staged reference to the ALREADY-NORMALIZED 1920×1080 prepared file (resolved via
  // staticFile() at render time, like a staged photo). Never a public URL.
  videoSrc: string;
  // Body (video) duration in seconds — the composition frames it with the shared
  // opening/closing cards; the TOTAL output duration is owned by calculateMetadata, not
  // duplicated here.
  durationSeconds: number;
  hasAudio: boolean;
  brand: CardBrand;
  cta: CardCta;
  badge: CardBadge | null;
}

export type CompositionInput = PhotoSlideshowCompositionInput | UploadedVideoCompositionInput;

// The discriminant values, as a runtime-enumerable list (kept in lockstep with the union
// via the exhaustiveness test).
export const COMPOSITION_INPUT_SOURCES = ["photo_slideshow", "uploaded_video"] as const;
export type CompositionInputSource = (typeof COMPOSITION_INPUT_SOURCES)[number];

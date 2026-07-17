// Input contract for the `ListingVideo` Remotion composition, plus the pure
// timing helpers that derive frame counts from it. This module has no
// React/Remotion runtime imports — the composition is a pure function of
// `inputProps`, and the schema + helpers here are unit-tested independently
// of the JSX (see input.test.ts).
//
// `trace_id` deliberately does NOT live here — correlation IDs belong to the
// Creative Job layer (src/lib/creative-jobs/), not the composition.
import { z } from "zod";
import { DEFAULT_CLOSING_SECONDS, DEFAULT_OPENING_SECONDS, DEFAULT_PHOTO_SECONDS } from "./layout";

export const listingVideoInputSchema = z.object({
  property: z.object({
    addressLine: z.string(),
    name: z.string().optional(),
  }),
  priceLabel: z.string(),
  photos: z
    .array(
      z.object({
        url: z.string(),
        roomLabel: z.string().optional(),
      }),
    )
    .min(1),
  brand: z.object({
    name: z.string(),
  }),
  cta: z.object({
    text: z.string(),
  }),
  // Reserved for future badges ("New" / "Price Reduced" / "Open House", …).
  // P2 always passes `null`; the layout keeps a safe area clear so a badge
  // can drop in later without redesigning the composition.
  badge: z
    .object({
      text: z.string(),
    })
    .nullable()
    .optional(),
});

export type ListingVideoInput = z.infer<typeof listingVideoInputSchema>;
export type ListingVideoPhoto = ListingVideoInput["photos"][number];

// Each photo is shown for a fixed duration (in whole frames), independent of
// how many photos there are — a longer gallery makes a longer video rather
// than compressing each photo's on-screen time. `Math.max(1, …)` guarantees
// this never collapses to a zero-frame (unrenderable) sequence.
export function perPhotoDurationFrames(_photoCount: number, fps: number, photoSeconds: number): number {
  return Math.max(1, Math.round(fps * photoSeconds));
}

// Identity today (no explicit ordering field on a photo yet) — a seam so a
// future ordering concept (sort key, "hero photo first", …) is a change
// inside this function, not at every call site.
export function orderedPhotos<T>(photos: readonly T[]): T[] {
  return [...photos];
}

export interface DurationOptions {
  photoSeconds?: number;
  openingSeconds?: number;
  closingSeconds?: number;
}

// Opening card + one sequence per photo + closing card, in whole frames.
export function totalDurationFrames(photoCount: number, fps: number, opts: DurationOptions = {}): number {
  const photoSeconds = opts.photoSeconds ?? DEFAULT_PHOTO_SECONDS;
  const openingSeconds = opts.openingSeconds ?? DEFAULT_OPENING_SECONDS;
  const closingSeconds = opts.closingSeconds ?? DEFAULT_CLOSING_SECONDS;

  const openingFrames = Math.round(fps * openingSeconds);
  const closingFrames = Math.round(fps * closingSeconds);
  const photosFrames = photoCount * perPhotoDurationFrames(photoCount, fps, photoSeconds);

  return openingFrames + photosFrames + closingFrames;
}

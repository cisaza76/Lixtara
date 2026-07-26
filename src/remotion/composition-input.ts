// F3-A Step 4 — the discriminated input the SHARED `ListingVideo` composition accepts,
// as a runtime zod schema. This is the wired, in-Remotion counterpart of the frozen
// contract in `src/lib/video-engine/composition-input.ts` (structural equivalence is
// asserted at compile time in composition-input.test.ts). It is deliberately
// SELF-CONTAINED — it imports NOTHING from `@/lib/video-engine` — so `@remotion/bundler`
// can bundle the composition in the sandbox without dragging the video-engine tree in.
//
// The `source` discriminant is OPTIONAL on the photo arm and DEFAULTS to
// "photo_slideshow". That is what lets the EXISTING photo render path keep sending its
// current `source`-less inputProps unchanged (no worker change) while the same
// composition also accepts an `uploaded_video` input — the whole point of F2/F3: one
// composition, switch only the Source Strategy, Render Profile untouched.
import { z } from "zod";
import { listingVideoInputSchema } from "./input";

// Photo slideshow arm = the existing photo input shape + an optional discriminant.
export const photoSlideshowInputSchema = listingVideoInputSchema.extend({
  source: z.literal("photo_slideshow").optional(),
});

// Uploaded video arm. `videoSrc` is a staged reference to an ALREADY-NORMALIZED 1920×1080
// prepared file (resolved via staticFile at render). There is deliberately NO aspect /
// objectFit / letterbox / blurred-fill field: layout was resolved upstream (F2-D Strategy
// C); the composition never resolves layout.
export const uploadedVideoInputSchema = z.object({
  source: z.literal("uploaded_video"),
  property: z.object({ addressLine: z.string(), name: z.string().optional() }),
  priceLabel: z.string(),
  videoSrc: z.string(),
  durationSeconds: z.number().positive(),
  hasAudio: z.boolean(),
  brand: z.object({ name: z.string() }),
  cta: z.object({ text: z.string() }),
  badge: z.object({ text: z.string() }).nullable().optional(),
});

// Union (NOT discriminatedUnion — the photo discriminant is optional). Try the video arm
// first so an explicit `uploaded_video` input matches it; a `source`-less or
// `photo_slideshow` input falls through to the photo arm.
export const compositionInputSchema = z.union([uploadedVideoInputSchema, photoSlideshowInputSchema]);

export type PhotoSlideshowInput = z.infer<typeof photoSlideshowInputSchema>;
export type UploadedVideoInput = z.infer<typeof uploadedVideoInputSchema>;
export type CompositionInput = z.infer<typeof compositionInputSchema>;

export const COMPOSITION_INPUT_SOURCES = ["photo_slideshow", "uploaded_video"] as const;

// Normalizes the optional discriminant so the component/metadata can switch on a concrete
// value ("photo_slideshow" when absent).
export function compositionSourceOf(input: CompositionInput): "photo_slideshow" | "uploaded_video" {
  return "source" in input && input.source === "uploaded_video" ? "uploaded_video" : "photo_slideshow";
}

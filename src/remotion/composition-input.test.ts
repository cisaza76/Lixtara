import { describe, it, expect } from "vitest";
import {
  compositionInputSchema,
  photoSlideshowInputSchema,
  uploadedVideoInputSchema,
  compositionSourceOf,
  COMPOSITION_INPUT_SOURCES,
  type CompositionInput,
  type UploadedVideoInput,
  type PhotoSlideshowInput,
} from "./composition-input";
// Frozen contract (video-engine) — imported for a COMPILE-TIME structural-equivalence check
// only. This test file is host-only (never bundled into the sandbox), so importing across
// the boundary here is fine.
import type {
  CompositionInput as VeCompositionInput,
  UploadedVideoCompositionInput as VeUploadedVideoInput,
  PhotoSlideshowCompositionInput as VePhotoInput,
} from "@/lib/video-engine/composition-input";

const photo = {
  property: { addressLine: "482 Coral Way, FL" },
  priceLabel: "$725,000",
  photos: [{ url: "asset-0.jpg", roomLabel: "Living Room" }],
  brand: { name: "Lixtara" },
  cta: { text: "See more" },
  badge: null,
};
const video = {
  source: "uploaded_video" as const,
  property: { addressLine: "482 Coral Way, FL" },
  priceLabel: "$725,000",
  videoSrc: "prepared-0.mp4",
  durationSeconds: 30,
  hasAudio: true,
  brand: { name: "Lixtara" },
  cta: { text: "See more" },
  badge: null,
};

describe("compositionInputSchema — one schema, two Source Strategies", () => {
  it("accepts a source-LESS photo input (existing photo path unchanged → no worker change)", () => {
    const r = compositionInputSchema.safeParse(photo);
    expect(r.success).toBe(true);
    if (r.success) expect(compositionSourceOf(r.data)).toBe("photo_slideshow");
  });
  it("accepts an explicit photo_slideshow input", () => {
    expect(compositionInputSchema.safeParse({ ...photo, source: "photo_slideshow" }).success).toBe(true);
  });
  it("accepts an uploaded_video input", () => {
    const r = compositionInputSchema.safeParse(video);
    expect(r.success).toBe(true);
    if (r.success) expect(compositionSourceOf(r.data)).toBe("uploaded_video");
  });
  it("rejects an uploaded_video missing videoSrc / durationSeconds", () => {
    expect(uploadedVideoInputSchema.safeParse({ ...video, videoSrc: undefined }).success).toBe(false);
    expect(uploadedVideoInputSchema.safeParse({ ...video, durationSeconds: undefined }).success).toBe(false);
    expect(uploadedVideoInputSchema.safeParse({ ...video, durationSeconds: 0 }).success).toBe(false);
  });
  it("rejects a photo input with an empty photo list (unchanged min-1 rule)", () => {
    expect(photoSlideshowInputSchema.safeParse({ ...photo, photos: [] }).success).toBe(false);
  });
  it("COMPOSITION_INPUT_SOURCES enumerates exactly the two arms", () => {
    expect([...COMPOSITION_INPUT_SOURCES].sort()).toEqual(["photo_slideshow", "uploaded_video"]);
  });
});

describe("compositionSourceOf normalizes the optional discriminant", () => {
  it("absent source → photo_slideshow", () => {
    expect(compositionSourceOf(photo as CompositionInput)).toBe("photo_slideshow");
  });
  it("uploaded_video → uploaded_video", () => {
    expect(compositionSourceOf(video as CompositionInput)).toBe("uploaded_video");
  });
});

describe("structural equivalence with the frozen video-engine contract (compile-time)", () => {
  it("the frozen contract's values satisfy the Remotion schema types", () => {
    // A value typed as the FROZEN video-engine uploaded-video arm is assignable to the
    // Remotion schema's inferred uploaded-video type (identical field shapes).
    const fromFrozenVideo: VeUploadedVideoInput = {
      source: "uploaded_video",
      property: { addressLine: "x" },
      priceLabel: "$1",
      videoSrc: "prepared-0.mp4",
      durationSeconds: 12,
      hasAudio: false,
      brand: { name: "L" },
      cta: { text: "c" },
      badge: null,
    };
    const asRemotion: UploadedVideoInput = fromFrozenVideo;
    expect(asRemotion.source).toBe("uploaded_video");

    // Frozen photo arm (source REQUIRED) is assignable to the Remotion photo arm (source OPTIONAL).
    const fromFrozenPhoto: VePhotoInput = {
      source: "photo_slideshow",
      property: { addressLine: "x" },
      priceLabel: "$1",
      photos: [{ url: "a" }],
      brand: { name: "L" },
      cta: { text: "c" },
      badge: null,
    };
    const asRemotionPhoto: PhotoSlideshowInput = fromFrozenPhoto;
    expect(asRemotionPhoto.photos.length).toBe(1);

    // And the union direction: a frozen CompositionInput is assignable to the Remotion one.
    const anyFrozen: VeCompositionInput = fromFrozenVideo;
    const asRemotionUnion: CompositionInput = anyFrozen;
    expect(compositionSourceOf(asRemotionUnion)).toBe("uploaded_video");
  });
});

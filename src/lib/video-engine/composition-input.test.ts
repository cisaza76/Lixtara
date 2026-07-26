import { describe, it, expect } from "vitest";
import {
  COMPOSITION_INPUT_SOURCES,
  type CompositionInput,
  type PhotoSlideshowCompositionInput,
  type UploadedVideoCompositionInput,
} from "./composition-input";

const photo: PhotoSlideshowCompositionInput = {
  source: "photo_slideshow",
  property: { addressLine: "1 A St" },
  priceLabel: "$1",
  photos: [{ url: "asset-0.jpg" }],
  brand: { name: "Lixtara" },
  cta: { text: "x" },
  badge: null,
};
const video: UploadedVideoCompositionInput = {
  source: "uploaded_video",
  property: { addressLine: "1 A St" },
  priceLabel: "$1",
  videoSrc: "prepared-0.mp4",
  durationSeconds: 30,
  hasAudio: true,
  brand: { name: "Lixtara" },
  cta: { text: "x" },
  badge: null,
};

// Compile-time exhaustiveness: if a new arm is added to the union without a case here, this
// stops compiling (assertNever). Runtime asserts the discriminant round-trips.
function labelOf(input: CompositionInput): string {
  switch (input.source) {
    case "photo_slideshow":
      return `photos:${input.photos.length}`;
    case "uploaded_video":
      return `video:${input.durationSeconds}s`;
    default: {
      const never: never = input;
      throw new Error(`unhandled CompositionInput arm: ${JSON.stringify(never)}`);
    }
  }
}

describe("CompositionInput — discriminated union", () => {
  it("narrows on `source`", () => {
    expect(labelOf(photo)).toBe("photos:1");
    expect(labelOf(video)).toBe("video:30s");
  });
  it("COMPOSITION_INPUT_SOURCES lists exactly the union arms", () => {
    expect([...COMPOSITION_INPUT_SOURCES].sort()).toEqual(["photo_slideshow", "uploaded_video"]);
  });
  it("the uploaded_video arm carries hasAudio + durationSeconds, never an objectFit/aspect decision", () => {
    // The contract deliberately has no layout/aspect/objectFit field — the composition
    // never resolves layout; the prepared file is already 1920×1080.
    expect(Object.keys(video)).not.toContain("objectFit");
    expect(Object.keys(video)).not.toContain("aspect");
    expect(video.videoSrc).toBe("prepared-0.mp4");
  });
});

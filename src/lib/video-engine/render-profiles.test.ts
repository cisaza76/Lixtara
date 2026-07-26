import { describe, it, expect } from "vitest";
import { RENDER_PROFILES, RENDER_PROFILE_REGISTRY, getRenderProfile, type RenderProfile } from "./render-profiles";
import type { CompositionInput } from "./composition-input";

const photoInput: CompositionInput = {
  source: "photo_slideshow",
  property: { addressLine: "1 A St" },
  priceLabel: "$1",
  photos: [{ url: "a" }, { url: "b" }],
  brand: { name: "Lixtara" },
  cta: { text: "x" },
  badge: null,
};
const videoWithAudio: CompositionInput = {
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
const videoNoAudio: CompositionInput = { ...videoWithAudio, hasAudio: false };

describe("Render Profile registry", () => {
  it("has a spec for every profile and nothing extra", () => {
    expect(Object.keys(RENDER_PROFILE_REGISTRY).sort()).toEqual([...RENDER_PROFILES].sort());
    for (const p of RENDER_PROFILES) expect(getRenderProfile(p).id).toBe(p);
  });
  it("standard is 1920×1080/30 h264/aac driving the shared ListingVideo composition", () => {
    const s = getRenderProfile("standard");
    expect(s).toMatchObject({ width: 1920, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac", compositionId: "ListingVideo" });
  });
});

describe("expectedQaSpec — pure, profile-static dims + input-derived audio (audio-aware)", () => {
  const standard = getRenderProfile("standard");

  it("photo_slideshow → audioExpected false (no photo-render audio regression)", () => {
    const spec = standard.expectedQaSpec(photoInput, 17);
    expect(spec).toMatchObject({ container: "mp4", codec: "h264", width: 1920, height: 1080, fps: 30, durationSec: 17, audioExpected: false });
    expect(spec.audioCodec).toBeUndefined();
    expect(spec.aspect).toEqual({ width: 16, height: 9 });
  });

  it("uploaded_video with audio → audioExpected true + aac", () => {
    const spec = standard.expectedQaSpec(videoWithAudio, 36);
    expect(spec.audioExpected).toBe(true);
    expect(spec.audioCodec).toBe("aac");
    expect(spec.durationSec).toBe(36);
  });

  it("uploaded_video without audio → audioExpected false", () => {
    const spec = standard.expectedQaSpec(videoNoAudio, 36);
    expect(spec.audioExpected).toBe(false);
    expect(spec.audioCodec).toBeUndefined();
  });

  it("duration comes from the caller (composition metadata), never recomputed here", () => {
    expect(standard.expectedQaSpec(videoWithAudio, 12.5).durationSec).toBe(12.5);
    expect(standard.expectedQaSpec(videoWithAudio, 59).durationSec).toBe(59);
  });
});

describe("profile enum stability", () => {
  it("is exactly the standard profile for the MVP", () => {
    const all: RenderProfile[] = [...RENDER_PROFILES];
    expect(all).toEqual(["standard"]);
  });
});

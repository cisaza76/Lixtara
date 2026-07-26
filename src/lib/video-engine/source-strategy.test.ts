import { describe, it, expect } from "vitest";
import {
  SOURCE_STRATEGIES,
  SOURCE_STRATEGY_REGISTRY,
  compositionSourceForStrategy,
  type SourceStrategy,
  type SelectedSource,
  type PreparedSource,
  type PreparedVideoSource,
} from "./source-strategy";
import { COMPOSITION_INPUT_SOURCES } from "./composition-input";

describe("Source Strategy registry", () => {
  it("has a descriptor for every strategy and nothing extra", () => {
    expect(Object.keys(SOURCE_STRATEGY_REGISTRY).sort()).toEqual([...SOURCE_STRATEGIES].sort());
    for (const s of SOURCE_STRATEGIES) {
      expect(SOURCE_STRATEGY_REGISTRY[s].id).toBe(s);
    }
  });
  it("photo_slideshow needs no preparation; uploaded_video does", () => {
    expect(SOURCE_STRATEGY_REGISTRY.photo_slideshow.requiresPreparation).toBe(false);
    expect(SOURCE_STRATEGY_REGISTRY.uploaded_video.requiresPreparation).toBe(true);
  });
  it("each strategy maps to a real CompositionInput arm", () => {
    for (const s of SOURCE_STRATEGIES) {
      expect(COMPOSITION_INPUT_SOURCES).toContain(compositionSourceForStrategy(s));
    }
  });
});

// Compile-time exhaustiveness over SelectedSource / PreparedSource.
function selectedLabel(sel: SelectedSource): string {
  switch (sel.strategy) {
    case "photo_slideshow":
      return `photos:${sel.photos.length}`;
    case "uploaded_video":
      return `video-asset:${sel.asset.assetId}`;
    default: {
      const never: never = sel;
      throw new Error(String(never));
    }
  }
}
function preparedLabel(p: PreparedSource): string {
  switch (p.strategy) {
    case "photo_slideshow":
      return `photos:${p.photos.length}`;
    case "uploaded_video":
      return `video:${p.video.path}`;
    default: {
      const never: never = p;
      throw new Error(String(never));
    }
  }
}

describe("SelectedSource / PreparedSource — discriminated unions", () => {
  it("narrow on strategy", () => {
    expect(
      selectedLabel({ strategy: "photo_slideshow", photos: [{ assetId: "a", storageBucket: "b", storagePath: "p" }] }),
    ).toBe("photos:1");
    expect(
      selectedLabel({
        strategy: "uploaded_video",
        asset: { assetId: "v1", listingId: "l", ownerId: "o", storageBucket: "b", storagePath: "p", bytes: 1, mime: "video/mp4" },
      }),
    ).toBe("video-asset:v1");
  });

  it("PreparedVideoSource fixes output shape to 1920×1080/30 h264 and keeps `path` internal", () => {
    const pv: PreparedVideoSource = {
      path: "/workspace/prepared-0.mp4",
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
      sourceHash: "sha256:...",
      preparationFingerprint: "fp:...",
      sourceMetadata: {
        container: "mov,mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 30,
        bytes: 1,
        rotationDegrees: 0,
      },
      transformations: ["blurred-fill 9:16→16:9"],
      ffmpegVersion: "8.1.2",
      runtimeVersion: "base-2026-07-21-...",
      preparedBytes: 123,
    };
    expect(preparedLabel({ strategy: "uploaded_video", video: pv })).toBe("video:/workspace/prepared-0.mp4");
    // `path` is an internal ref, never a public URL.
    expect(pv.path.startsWith("http")).toBe(false);
    expect(pv.width).toBe(1920);
    expect(pv.height).toBe(1080);
  });
});

describe("strategy enum stability", () => {
  it("is exactly the two MVP strategies", () => {
    const all: SourceStrategy[] = [...SOURCE_STRATEGIES];
    expect(all.sort()).toEqual(["photo_slideshow", "uploaded_video"]);
  });
});

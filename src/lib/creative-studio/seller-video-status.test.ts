import { describe, it, expect } from "vitest";
import { mapJobStateToSeller, deriveVideoMeta } from "@/lib/creative-studio/seller-video-status";
import type { CreativeJobState } from "@/lib/creative-jobs/states";
import type { Asset } from "@/lib/assets/types";

describe("mapJobStateToSeller", () => {
  it("maps null to idle", () => {
    expect(mapJobStateToSeller(null)).toBe("idle");
  });

  it("maps completed to completed", () => {
    expect(mapJobStateToSeller("completed")).toBe("completed");
  });

  it("maps failed to failed", () => {
    expect(mapJobStateToSeller("failed")).toBe("failed");
  });

  it("maps cancelled to idle (seller can create again)", () => {
    expect(mapJobStateToSeller("cancelled")).toBe("idle");
  });

  it.each<CreativeJobState>(["queued", "running", "rendering", "qa", "uploading"])(
    "maps %s to creating",
    (state) => {
      expect(mapJobStateToSeller(state)).toBe("creating");
    },
  );
});

describe("deriveVideoMeta", () => {
  const baseAsset = {
    createdAt: "2026-07-14T12:00:00.000Z",
  } as Pick<Asset, "createdAt" | "qa" | "provenance">;

  it("extracts durationSeconds, resolutionLabel, and photoCount from a valid qa/provenance", () => {
    const asset = {
      ...baseAsset,
      qa: { durationSec: 17.2, width: 1920, height: 1080, ok: true },
      provenance: {
        sourceAssetIds: ["a", "b", "c"],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
    } as Pick<Asset, "createdAt" | "qa" | "provenance">;

    const meta = deriveVideoMeta(asset);

    expect(meta).toEqual({
      createdAt: "2026-07-14T12:00:00.000Z",
      durationSeconds: 17.2,
      resolutionLabel: "1080p",
      photoCount: 3,
    });
  });

  it("returns null durationSeconds/resolutionLabel when qa is null", () => {
    const asset = {
      ...baseAsset,
      qa: null,
      provenance: {
        sourceAssetIds: ["a"],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
    } as Pick<Asset, "createdAt" | "qa" | "provenance">;

    const meta = deriveVideoMeta(asset);

    expect(meta.durationSeconds).toBeNull();
    expect(meta.resolutionLabel).toBeNull();
  });

  it("returns null durationSeconds/resolutionLabel when qa is an empty object missing fields", () => {
    const asset = {
      ...baseAsset,
      qa: {},
      provenance: {
        sourceAssetIds: ["a"],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
    } as Pick<Asset, "createdAt" | "qa" | "provenance">;

    const meta = deriveVideoMeta(asset);

    expect(meta.durationSeconds).toBeNull();
    expect(meta.resolutionLabel).toBeNull();
  });

  it("returns null durationSeconds/resolutionLabel when qa is a non-object (garbage) value, without throwing", () => {
    const asset = {
      ...baseAsset,
      qa: "garbage",
      provenance: {
        sourceAssetIds: ["a"],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
    } as unknown as Pick<Asset, "createdAt" | "qa" | "provenance">;

    expect(() => deriveVideoMeta(asset)).not.toThrow();
    const meta = deriveVideoMeta(asset);
    expect(meta.durationSeconds).toBeNull();
    expect(meta.resolutionLabel).toBeNull();
  });

  it("returns null photoCount when provenance lacks a sourceAssetIds array", () => {
    const asset = {
      ...baseAsset,
      qa: null,
      provenance: {
        sourceAssetIds: undefined,
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
    } as unknown as Pick<Asset, "createdAt" | "qa" | "provenance">;

    const meta = deriveVideoMeta(asset);
    expect(meta.photoCount).toBeNull();
  });

  it("passes createdAt through unchanged", () => {
    const asset = {
      createdAt: "2020-01-01T00:00:00.000Z",
      qa: null,
      provenance: {
        sourceAssetIds: [],
        capability: "video",
        engine: "video-engine",
        provider: "remotion",
        prompt: null,
      },
    } as Pick<Asset, "createdAt" | "qa" | "provenance">;

    const meta = deriveVideoMeta(asset);
    expect(meta.createdAt).toBe("2020-01-01T00:00:00.000Z");
  });
});

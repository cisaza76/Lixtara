import { describe, it, expect } from "vitest";
import { decideSourceStrategy, isUsableSourceVideo } from "./job-routing";
import type { Asset } from "@/lib/assets/types";

const base: Asset = {
  id: "a", listingId: "L", ownerId: "O", kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: "u1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: "source/O/L/a/source.mp4", checksum: null, bytes: 10, mime: "video/mp4",
  costUsd: 0, costProvider: null, createdBy: "O", lifecycle: "draft", qa: null, policy: null, createdAt: "2026-07-23T00:00:00Z",
};

describe("isUsableSourceVideo", () => {
  it("accepts a seller-upload video with a real storage location", () => {
    expect(isUsableSourceVideo(base)).toBe(true);
  });
  it("rejects null/undefined, a photo, a generated video, or a missing storage location", () => {
    expect(isUsableSourceVideo(null)).toBe(false);
    expect(isUsableSourceVideo(undefined)).toBe(false);
    expect(isUsableSourceVideo({ ...base, kind: "photo" })).toBe(false);
    expect(isUsableSourceVideo({ ...base, sourceType: "generated" })).toBe(false);
    expect(isUsableSourceVideo({ ...base, storagePath: "" })).toBe(false);
    expect(isUsableSourceVideo({ ...base, storageBucket: "" })).toBe(false);
  });
});

describe("decideSourceStrategy (backend-only, reuses resolveVideoSource)", () => {
  it("valid Source Asset → uploaded_video", async () => {
    expect(await decideSourceStrategy(async () => base, "L", "O")).toBe("uploaded_video");
  });
  it("no Source Asset → photo_slideshow", async () => {
    expect(await decideSourceStrategy(async () => null, "L", "O")).toBe("photo_slideshow");
  });
  it("malformed/invalid Source Asset does NOT break routing → photo_slideshow", async () => {
    expect(await decideSourceStrategy(async () => ({ ...base, storagePath: "" }), "L", "O")).toBe("photo_slideshow");
    expect(await decideSourceStrategy(async () => ({ ...base, kind: "photo" }), "L", "O")).toBe("photo_slideshow");
  });
  it("resolver failure falls back to photo_slideshow (never throws)", async () => {
    expect(
      await decideSourceStrategy(async () => {
        throw new Error("db down");
      }, "L", "O"),
    ).toBe("photo_slideshow");
  });
  it("no resolver → photo_slideshow", async () => {
    expect(await decideSourceStrategy(undefined, "L", "O")).toBe("photo_slideshow");
  });
});

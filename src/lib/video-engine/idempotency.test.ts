import { describe, it, expect } from "vitest";
import { buildIdempotencyKey, hashSourceAssetIds } from "@/lib/video-engine/idempotency";

const base = {
  listingId: "listing-1",
  capability: "video",
  templateVersion: "1",
  sourceAssetIds: ["photo-a", "photo-b"],
  inputHash: hashSourceAssetIds(["photo-a", "photo-b"]),
};

describe("buildIdempotencyKey", () => {
  it("is deterministic: identical inputs -> identical key", () => {
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it("is order-independent over sourceAssetIds", () => {
    const reordered = { ...base, sourceAssetIds: ["photo-b", "photo-a"] };
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey(reordered));
  });

  it("changes when the source-asset SET changes", () => {
    const differentAssets = { ...base, sourceAssetIds: ["photo-a", "photo-c"] };
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey(differentAssets));
  });

  it("changes when listingId changes", () => {
    const other = { ...base, listingId: "listing-2" };
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey(other));
  });

  it("changes when capability changes", () => {
    const other = { ...base, capability: "image" };
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey(other));
  });

  it("changes when templateVersion changes", () => {
    const other = { ...base, templateVersion: "2" };
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey(other));
  });

  it("changes when inputHash changes", () => {
    const other = { ...base, inputHash: "different-hash" };
    expect(buildIdempotencyKey(base)).not.toBe(buildIdempotencyKey(other));
  });

  it("produces a 64-char hex sha256 digest", () => {
    expect(buildIdempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashSourceAssetIds", () => {
  it("is deterministic and order-independent", () => {
    expect(hashSourceAssetIds(["a", "b"])).toBe(hashSourceAssetIds(["b", "a"]));
  });

  it("differs for a different id set", () => {
    expect(hashSourceAssetIds(["a", "b"])).not.toBe(hashSourceAssetIds(["a", "c"]));
  });
});

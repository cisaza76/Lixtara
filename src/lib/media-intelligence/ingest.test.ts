import { describe, it, expect } from "vitest";
import { toAssets, MIN_PHOTOS, TooFewPhotosError } from "@/lib/media-intelligence/ingest";

describe("toAssets", () => {
  it("maps rows to assets and requires MIN_PHOTOS", () => {
    const rows = Array.from({ length: MIN_PHOTOS }, (_, i) => ({ id: `p${i}`, url: `http://x/${i}` }));
    const assets = toAssets(rows);
    expect(assets).toHaveLength(MIN_PHOTOS);
    expect(assets[0]).toEqual({ photoId: "p0", url: "http://x/0" });
  });
  it("drops rows with no url then throws if below the minimum", () => {
    const rows = [{ id: "a", url: "http://x/a" }, { id: "b", url: "" }];
    expect(() => toAssets(rows)).toThrow(TooFewPhotosError);
  });
});

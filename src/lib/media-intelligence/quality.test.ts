import { describe, it, expect } from "vitest";
import { scoreAssets } from "@/lib/media-intelligence/quality";
import type { Asset } from "@/lib/media-intelligence/types";

describe("scoreAssets", () => {
  it("maps model output to normalized QualityScore rows", async () => {
    const assets: Asset[] = [{ photoId: "a", url: "http://x/a" }];
    const fakeGenerate = async () => ({
      object: { scores: [{ photoId: "a", sharpness: 0.8, lighting: 0.7, framing: 0.6, duplicateOf: null }] },
    });
    const out = await scoreAssets(assets, { generate: fakeGenerate as never });
    expect(out[0].photoId).toBe("a");
    expect(out[0].overall).toBeCloseTo((0.8 + 0.7 + 0.6) / 3, 5);
    expect(out[0].duplicateOf).toBeUndefined();
  });
});

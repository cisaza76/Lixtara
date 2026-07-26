import { describe, it, expect } from "vitest";
import { toSellerSourceDto, sourceStatusFromLifecycle } from "./seller-source-status";
import type { Asset } from "@/lib/assets/types";

const sourceAsset = (o: Partial<Asset> = {}): Asset => ({
  id: "asset-1", listingId: "L", ownerId: "O", kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: "up-1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: "source/O/L/asset-1/source.mp4", checksum: null, bytes: 12_345_678,
  mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: "O", lifecycle: "draft", qa: null, policy: null,
  createdAt: "2026-07-23T10:00:00.000Z", ...o,
});

describe("toSellerSourceDto", () => {
  it("no asset → exists:false", () => {
    expect(toSellerSourceDto(null)).toEqual({ exists: false });
  });
  it("maps a source asset to the seller DTO (draft → pending_validation)", () => {
    expect(toSellerSourceDto(sourceAsset())).toEqual({
      exists: true,
      source: {
        assetId: "asset-1",
        sizeBytes: 12_345_678,
        mimeType: "video/mp4",
        uploadedAt: "2026-07-23T10:00:00.000Z",
        status: "pending_validation",
      },
    });
  });
  it("never leaks internal Asset fields (path/bucket/provenance/sourceId)", () => {
    const dto = toSellerSourceDto(sourceAsset());
    const serialized = JSON.stringify(dto);
    for (const leak of ["storagePath", "storageBucket", "provenance", "sourceId", "createdBy", "source/O/L", "creative-studio"]) {
      expect(serialized).not.toContain(leak);
    }
  });
  it("lifecycle mapping", () => {
    expect(sourceStatusFromLifecycle("draft")).toBe("pending_validation");
    expect(sourceStatusFromLifecycle("approved")).toBe("uploaded");
    expect(sourceStatusFromLifecycle("ready_for_review")).toBe("uploaded");
  });
});

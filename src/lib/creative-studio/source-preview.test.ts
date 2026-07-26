import { describe, it, expect } from "vitest";
import {
  toSourcePreviewDto,
  isAccessExpired,
  accessExpiresAt,
  SOURCE_PREVIEW_TTL_SECONDS,
  type TemporaryMediaAccess,
} from "./source-preview";
import type { Asset } from "@/lib/assets/types";

const asset = (o: Partial<Asset> = {}): Asset => ({
  id: "asset-1", listingId: "L", ownerId: "O", kind: "video", version: 1, parentAsset: null,
  sourceType: "seller_upload", sourceId: "up-1",
  provenance: { sourceAssetIds: [], capability: "video", engine: "asset-manager", provider: "seller_upload", prompt: null },
  storageBucket: "creative-studio", storagePath: "source/O/L/asset-1/source.mp4", checksum: null, bytes: 12_345_678,
  mime: "video/mp4", costUsd: 0, costProvider: null, createdBy: "O", lifecycle: "draft", qa: null, policy: null,
  createdAt: "2026-07-23T10:00:00.000Z", ...o,
});
const access: TemporaryMediaAccess = { locator: "https://signed.example/x?token=abc", expiresAt: "2026-07-23T10:05:00.000Z" };

describe("TTL", () => {
  it("is 5 minutes", () => {
    expect(SOURCE_PREVIEW_TTL_SECONDS).toBe(300);
  });
});

describe("toSourcePreviewDto", () => {
  it("no asset or no access → exists:false", () => {
    expect(toSourcePreviewDto(null, access)).toEqual({ exists: false });
    expect(toSourcePreviewDto(asset(), null)).toEqual({ exists: false });
  });
  it("maps to a temporary-access descriptor + meta (durationSeconds null server-side)", () => {
    expect(toSourcePreviewDto(asset(), access)).toEqual({
      exists: true,
      preview: {
        access,
        meta: { mimeType: "video/mp4", sizeBytes: 12_345_678, uploadedAt: "2026-07-23T10:00:00.000Z", durationSeconds: null },
      },
    });
  });
  it("never leaks bucket / storagePath / provenance / a separate token field", () => {
    const dto = toSourcePreviewDto(asset(), access);
    const serialized = JSON.stringify(dto);
    for (const leak of ["storagePath", "storageBucket", "provenance", "sourceId", "source/O/L", "creative-studio"]) {
      expect(serialized).not.toContain(leak);
    }
    // the URL itself is the ephemeral access (allowed); there is no separate `token` field.
    expect(dto.preview && "token" in dto.preview).toBe(false);
  });
});

describe("isAccessExpired (reactive renewal decision, no timers)", () => {
  const NOW = Date.parse("2026-07-23T10:03:00.000Z");
  it("null access → expired", () => {
    expect(isAccessExpired(null, NOW)).toBe(true);
  });
  it("future beyond skew → not expired", () => {
    expect(isAccessExpired({ locator: "u", expiresAt: "2026-07-23T10:10:00.000Z" }, NOW)).toBe(false);
  });
  it("past → expired", () => {
    expect(isAccessExpired({ locator: "u", expiresAt: "2026-07-23T10:02:00.000Z" }, NOW)).toBe(true);
  });
  it("within the skew window → treated as expired (renew early)", () => {
    expect(isAccessExpired({ locator: "u", expiresAt: "2026-07-23T10:03:03.000Z" }, NOW, 5000)).toBe(true);
  });
  it("invalid expiry → expired", () => {
    expect(isAccessExpired({ locator: "u", expiresAt: "not-a-date" }, NOW)).toBe(true);
  });
});

describe("accessExpiresAt", () => {
  it("is now + ttl", () => {
    const now = Date.parse("2026-07-23T10:00:00.000Z");
    expect(accessExpiresAt(now, 300)).toBe("2026-07-23T10:05:00.000Z");
  });
});

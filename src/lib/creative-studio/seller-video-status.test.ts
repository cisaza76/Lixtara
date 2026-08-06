import { describe, it, expect } from "vitest";
import { mapJobStateToSeller, deriveVideoMeta, deriveSellerFailure, isEquivalentFailure, madeFromStrategy } from "@/lib/creative-studio/seller-video-status";
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

// ---- UX 5C — seller-facing failure derivation --------------------------------------

describe("deriveSellerFailure — approved CTA matrix", () => {
  const base = { errorCode: "RENDER_TIMEOUT", traceId: "trace-x", remainingGenerations: 2, isRepeatEquivalentFailure: false };

  it("technical_retryable with capacity: retry allowed, support secondary", () => {
    const f = deriveSellerFailure(base);
    expect(f.kind).toBe("technical_retryable");
    expect(f.canRetry).toBe(true);
    expect(f.supportPrimary).toBe(false);
    expect(f.reference).toMatch(/^[A-F0-9]{8}$/);
  });

  it("source_action_required: NO retry (replace is the action), support secondary", () => {
    const f = deriveSellerFailure({ ...base, errorCode: "VIDEO_CORRUPT" });
    expect(f.kind).toBe("source_action_required");
    expect(f.canRetry).toBe(false);
    expect(f.supportPrimary).toBe(false);
  });

  it("technical_support: no retry, support primary", () => {
    const f = deriveSellerFailure({ ...base, errorCode: "RENDER_FAILED" });
    expect(f.kind).toBe("technical_support");
    expect(f.canRetry).toBe(false);
    expect(f.supportPrimary).toBe(true);
  });

  it("repeat equivalent failure: support becomes primary; retry stays available only while retryable + capacity", () => {
    const f = deriveSellerFailure({ ...base, isRepeatEquivalentFailure: true });
    expect(f.supportPrimary).toBe(true);
    expect(f.canRetry).toBe(true);
  });

  it("exhausted capacity: retry disappears, support primary — never a dead CTA", () => {
    const f = deriveSellerFailure({ ...base, remainingGenerations: 0 });
    expect(f.canRetry).toBe(false);
    expect(f.supportPrimary).toBe(true);
  });

  it("no traceId → reference null (still functional)", () => {
    expect(deriveSellerFailure({ ...base, traceId: null }).reference).toBeNull();
  });
});

describe("isEquivalentFailure — approved repetition rule", () => {
  const a = { errorCode: "RENDER_TIMEOUT", strategy: "uploaded_video", sourceAssetId: "s1" };

  it("same strategy + same source + same code → equivalent", () => {
    expect(isEquivalentFailure(a, { ...a })).toBe(true);
  });

  it("same strategy + same source + different code but SAME kind → equivalent", () => {
    expect(isEquivalentFailure(a, { ...a, errorCode: "SANDBOX_CREATE_FAILED" })).toBe(true);
  });

  it("different source asset → NOT equivalent (seller replaced the file)", () => {
    expect(isEquivalentFailure(a, { ...a, sourceAssetId: "s2" })).toBe(false);
  });

  it("different strategy → NOT equivalent", () => {
    expect(isEquivalentFailure(a, { ...a, strategy: "photo_slideshow" })).toBe(false);
  });

  it("different code AND different kind → NOT equivalent", () => {
    expect(isEquivalentFailure(a, { ...a, errorCode: "VIDEO_CORRUPT" })).toBe(false);
  });

  it("photo path (no source asset on either side) compares strategy + code/kind only", () => {
    const p = { errorCode: "RENDER_FAILED", strategy: "photo_slideshow", sourceAssetId: null };
    expect(isEquivalentFailure(p, { ...p })).toBe(true);
  });
});

describe("madeFromStrategy — chip source", () => {
  it("maps provenance strategies to the two approved chips", () => {
    expect(madeFromStrategy("photo_slideshow")).toBe("photos");
    expect(madeFromStrategy("uploaded_video")).toBe("uploaded_video");
    expect(madeFromStrategy(null)).toBe("photos"); // legacy assets predate the field
    expect(madeFromStrategy("unknown-future")).toBe("photos");
  });
});

describe("Etapa 1 — sourceIssue: 4 causas distinguibles sin exponer códigos", () => {
  const f = (errorCode: string) =>
    deriveSellerFailure({ errorCode, traceId: "t", remainingGenerations: 3, isRepeatEquivalentFailure: false });

  it("distingue contenedor / códec / HDR / corrupto", () => {
    expect(f("VIDEO_CONTAINER_UNSUPPORTED").sourceIssue).toBe("container");
    expect(f("VIDEO_CODEC_UNSUPPORTED").sourceIssue).toBe("codec");
    expect(f("VIDEO_HDR_UNSUPPORTED").sourceIssue).toBe("hdr");
    expect(f("VIDEO_CORRUPT").sourceIssue).toBe("corrupt");
  });

  it("todas son source_action_required (el vendedor puede actuar) y ninguna ofrece retry ciego", () => {
    for (const code of ["VIDEO_CONTAINER_UNSUPPORTED", "VIDEO_CODEC_UNSUPPORTED", "VIDEO_HDR_UNSUPPORTED", "VIDEO_CORRUPT"]) {
      expect(f(code).kind, code).toBe("source_action_required");
      expect(f(code).canRetry, code).toBe(false);
    }
  });

  it("otras causas de source usan el mensaje genérico (sourceIssue 'other')", () => {
    expect(f("VIDEO_DURATION_EXCEEDED").sourceIssue).toBe("other");
    expect(f("VIDEO_FILE_TOO_LARGE").sourceIssue).toBe("other");
  });

  it("los fallos técnicos NO llevan sourceIssue", () => {
    expect(f("RENDER_FAILED").sourceIssue).toBeUndefined();
    expect(f("SANDBOX_CREATE_FAILED").sourceIssue).toBeUndefined();
  });
});

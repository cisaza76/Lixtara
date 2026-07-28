import { describe, expect, it } from "vitest";
import { CREATIVE_JOB_ERROR_CODES, ERROR_CLASS } from "@/lib/creative-jobs/errors";
import { VIDEO_ERROR_CATALOG } from "@/lib/video-engine/video-errors";
import {
  referenceCodeFromTraceId,
  sellerFailureKindFor,
  type SellerFailureKind,
} from "@/lib/creative-studio/seller-failure-kind";

// Approved UX decision (2026-07-28): the visible failure treatment derives from an
// EXPLICIT property of the error — the existing `sellerFacing` flag in the video error
// catalog is the single source of truth for "the seller must act on their file"; the
// retry class decides between the two technical kinds. Category alone NEVER implies
// source fault (a preparation failure can be snapshot/sandbox/infra).
describe("sellerFailureKindFor — closed three-kind classification", () => {
  it("sellerFacing user_input codes → source_action_required (sellerFacing is the source of truth)", () => {
    for (const code of CREATIVE_JOB_ERROR_CODES) {
      const videoEntry = (VIDEO_ERROR_CATALOG as Record<string, { sellerFacing: boolean }>)[code];
      if (videoEntry?.sellerFacing) {
        expect(sellerFailureKindFor(code), code).toBe("source_action_required");
      }
    }
    expect(sellerFailureKindFor("VIDEO_CORRUPT")).toBe("source_action_required");
    expect(sellerFailureKindFor("VIDEO_CODEC_UNSUPPORTED")).toBe("source_action_required");
    expect(sellerFailureKindFor("VIDEO_DURATION_EXCEEDED")).toBe("source_action_required");
    expect(sellerFailureKindFor("VIDEO_SOURCE_MISSING")).toBe("source_action_required");
  });

  it("retriable non-seller codes → technical_retryable", () => {
    expect(sellerFailureKindFor("ASSET_DOWNLOAD_FAILED")).toBe("technical_retryable");
    expect(sellerFailureKindFor("SANDBOX_CREATE_FAILED")).toBe("technical_retryable");
    expect(sellerFailureKindFor("RENDER_TIMEOUT")).toBe("technical_retryable");
    expect(sellerFailureKindFor("STORAGE_UPLOAD_FAILED")).toBe("technical_retryable");
  });

  it("deterministic technical codes → technical_support (retry is not useful; PREPARATION is NOT source fault by itself)", () => {
    expect(sellerFailureKindFor("VIDEO_PREPARATION_FAILED")).toBe("technical_support");
    expect(sellerFailureKindFor("VIDEO_PREPARED_SOURCE_INVALID")).toBe("technical_support");
    expect(sellerFailureKindFor("RENDER_FAILED")).toBe("technical_support");
    expect(sellerFailureKindFor("TECHNICAL_QA_FAILED")).toBe("technical_support");
    expect(sellerFailureKindFor("FONT_STRATEGY_MISMATCH")).toBe("technical_support");
    expect(sellerFailureKindFor("JOB_ATTEMPTS_EXHAUSTED")).toBe("technical_support");
  });

  it("unknown/legacy codes degrade to technical_support (never throws, never invites blind retry)", () => {
    expect(sellerFailureKindFor("timeout")).toBe("technical_support");
    expect(sellerFailureKindFor("")).toBe("technical_support");
    expect(sellerFailureKindFor(null)).toBe("technical_support");
  });

  it("is total over the shared catalog and only ever returns the closed set", () => {
    const allowed: SellerFailureKind[] = ["source_action_required", "technical_retryable", "technical_support"];
    for (const code of CREATIVE_JOB_ERROR_CODES) {
      expect(allowed).toContain(sellerFailureKindFor(code));
    }
  });
});

describe("granular user_input codes reconciled into the shared catalog", () => {
  it("the seller-actionable codes are persistable CreativeJobErrorCodes, all non_retriable", () => {
    for (const code of ["VIDEO_CORRUPT", "VIDEO_CODEC_UNSUPPORTED", "VIDEO_CONTAINER_UNSUPPORTED", "VIDEO_STREAM_MISSING", "VIDEO_DURATION_EXCEEDED", "VIDEO_FILE_TOO_LARGE", "VIDEO_RESOLUTION_EXCEEDED"] as const) {
      expect(CREATIVE_JOB_ERROR_CODES, code).toContain(code);
      expect(ERROR_CLASS[code as (typeof CREATIVE_JOB_ERROR_CODES)[number]], code).toBe("non_retriable");
    }
  });
});

describe("referenceCodeFromTraceId — support handle without exposing internals", () => {
  it("8 uppercase hex chars, deterministic", () => {
    const a = referenceCodeFromTraceId("f8323ef6-ab19-4924-8936-f4e6df7cf43a");
    expect(a).toMatch(/^[A-F0-9]{8}$/);
    expect(referenceCodeFromTraceId("f8323ef6-ab19-4924-8936-f4e6df7cf43a")).toBe(a);
  });

  it("is NOT a substring/prefix of the traceId (cannot reconstruct the identifier)", () => {
    const trace = "f8323ef6-ab19-4924-8936-f4e6df7cf43a";
    const code = referenceCodeFromTraceId(trace);
    expect(trace.toUpperCase()).not.toContain(code);
  });

  it("different traceIds → different codes; null/empty → null", () => {
    expect(referenceCodeFromTraceId("aaaa")).not.toBe(referenceCodeFromTraceId("bbbb"));
    expect(referenceCodeFromTraceId(null)).toBeNull();
    expect(referenceCodeFromTraceId("")).toBeNull();
  });
});

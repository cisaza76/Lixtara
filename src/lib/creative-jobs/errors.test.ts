import { describe, expect, it } from "vitest";
import {
  CREATIVE_JOB_ERROR_CODES,
  ERROR_CLASS,
  classifyError,
  isRetriable,
  type CreativeJobErrorCode,
} from "@/lib/creative-jobs/errors";

// The retry logic (and any UI copy) depends on the CODE, never on free-text message —
// these tests exist to keep the code list, classification map, and helpers in lockstep
// as the single source of truth.

describe("CREATIVE_JOB_ERROR_CODES", () => {
  it("every code has an entry in ERROR_CLASS — no code is left unclassified", () => {
    for (const code of CREATIVE_JOB_ERROR_CODES) {
      expect(ERROR_CLASS[code]).toBeDefined();
    }
  });

  it("ERROR_CLASS has no stray keys beyond the declared code list", () => {
    const declared = new Set<string>(CREATIVE_JOB_ERROR_CODES);
    for (const key of Object.keys(ERROR_CLASS)) {
      expect(declared.has(key)).toBe(true);
    }
  });
});

describe("classifyError", () => {
  it("classifies transient infra failures as retriable", () => {
    const retriableCodes: CreativeJobErrorCode[] = [
      "ASSET_DOWNLOAD_FAILED",
      "SANDBOX_CREATE_FAILED",
      "RENDER_TIMEOUT",
      "STORAGE_UPLOAD_FAILED",
      "STORAGE_VERIFY_FAILED",
    ];
    for (const code of retriableCodes) {
      expect(classifyError(code)).toBe("retriable");
    }
  });

  it("classifies deterministic failures as non_retriable", () => {
    const nonRetriableCodes: CreativeJobErrorCode[] = [
      "RENDER_FAILED",
      "TECHNICAL_QA_FAILED",
      "ASSET_CREATE_FAILED",
      "JOB_ATTEMPTS_EXHAUSTED",
    ];
    for (const code of nonRetriableCodes) {
      expect(classifyError(code)).toBe("non_retriable");
    }
  });

  it("classifies JOB_CANCELLED as cancelled", () => {
    expect(classifyError("JOB_CANCELLED")).toBe("cancelled");
  });
});

describe("isRetriable", () => {
  it("matches classifyError exactly for every declared code", () => {
    for (const code of CREATIVE_JOB_ERROR_CODES) {
      expect(isRetriable(code)).toBe(classifyError(code) === "retriable");
    }
  });

  it("returns true only for retriable codes", () => {
    expect(isRetriable("RENDER_TIMEOUT")).toBe(true);
    expect(isRetriable("RENDER_FAILED")).toBe(false);
    expect(isRetriable("JOB_CANCELLED")).toBe(false);
  });
});

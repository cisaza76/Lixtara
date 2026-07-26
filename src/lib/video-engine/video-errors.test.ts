import { describe, it, expect } from "vitest";
import {
  VIDEO_ERROR_CODES,
  VIDEO_ERROR_CATEGORIES,
  VIDEO_ERROR_CATALOG,
  SHARED_PIPELINE_ERROR_CATEGORY,
  videoErrorCategory,
  isVideoErrorRetryable,
  type VideoErrorCategory,
} from "./video-errors";

describe("video error catalog — completeness", () => {
  it("every code has a catalog entry with matching code", () => {
    for (const code of VIDEO_ERROR_CODES) {
      expect(VIDEO_ERROR_CATALOG[code].code).toBe(code);
    }
  });
  it("no extra catalog entries beyond the declared codes", () => {
    expect(Object.keys(VIDEO_ERROR_CATALOG).sort()).toEqual([...VIDEO_ERROR_CODES].sort());
  });
  it("every category is a declared VideoErrorCategory", () => {
    for (const code of VIDEO_ERROR_CODES) {
      expect(VIDEO_ERROR_CATEGORIES).toContain(VIDEO_ERROR_CATALOG[code].category);
    }
  });
  it("includes the four newly-added codes", () => {
    for (const code of [
      "VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED",
      "VIDEO_PREPARED_SOURCE_INVALID",
      "VIDEO_PRIMARY_ASSET_INVALID",
      "VIDEO_STATE_TRANSITION_INVALID",
    ] as const) {
      expect(VIDEO_ERROR_CODES).toContain(code);
    }
  });
});

describe("origin taxonomy is fully represented (gate §Errores)", () => {
  it("the 7 core origins + 2 structural buckets are all present across video + shared codes", () => {
    const present = new Set<VideoErrorCategory>();
    for (const code of VIDEO_ERROR_CODES) present.add(VIDEO_ERROR_CATALOG[code].category);
    for (const cat of Object.values(SHARED_PIPELINE_ERROR_CATEGORY)) if (cat) present.add(cat);
    for (const core of ["user_input", "authorization", "preparation", "runtime", "render", "qa", "persistence"] as const) {
      expect(present.has(core)).toBe(true);
    }
    expect(present.has("primary")).toBe(true);
    expect(present.has("state")).toBe(true);
  });
});

describe("retryable classification", () => {
  it("the runtime dependency install failure is RETRYABLE and NOT a render failure (gate D1)", () => {
    expect(isVideoErrorRetryable("VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED")).toBe(true);
    expect(videoErrorCategory("VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED")).toBe("runtime");
    expect(videoErrorCategory("VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED")).not.toBe("render");
    expect(VIDEO_ERROR_CATALOG.VIDEO_RENDER_FAILED.code).not.toBe("VIDEO_RUNTIME_DEPENDENCY_INSTALL_FAILED");
  });
  it("deterministic user-input / render / qa / preparation failures are NON-retryable", () => {
    for (const code of [
      "VIDEO_CONTAINER_UNSUPPORTED",
      "VIDEO_CODEC_UNSUPPORTED",
      "VIDEO_DURATION_EXCEEDED",
      "VIDEO_FILE_TOO_LARGE",
      "VIDEO_RESOLUTION_EXCEEDED",
      "VIDEO_CORRUPT",
      "VIDEO_STREAM_MISSING",
      "VIDEO_SOURCE_UNAUTHORIZED",
      "VIDEO_PREPARATION_FAILED",
      "VIDEO_PREPARED_SOURCE_INVALID",
      "VIDEO_RENDER_FAILED",
      "VIDEO_QA_FAILED",
    ] as const) {
      expect(isVideoErrorRetryable(code)).toBe(false);
    }
  });
  it("user-input + authorization errors are the seller-facing ones", () => {
    expect(VIDEO_ERROR_CATALOG.VIDEO_DURATION_EXCEEDED.sellerFacing).toBe(true);
    expect(VIDEO_ERROR_CATALOG.VIDEO_RENDER_FAILED.sellerFacing).toBe(false);
    // authorization is intentionally NOT seller-facing detail (don't leak "someone else's asset").
    expect(VIDEO_ERROR_CATALOG.VIDEO_SOURCE_UNAUTHORIZED.sellerFacing).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { CREATIVE_JOB_ERROR_CODES, ERROR_CLASS } from "@/lib/creative-jobs/errors";
import {
  FAILURE_CATEGORIES,
  FAILURE_TAXONOMY,
  failureTaxonomyFor,
  type FailureCategory,
} from "@/lib/creative-jobs/failure-taxonomy";

// Issue #112 — the taxonomy must be DETERMINISTIC: a single catalog, no free-text
// sniffing. Every persistable error code maps to exactly one category + stage, so SQL
// like `metadata->'evidence'->'classification'->>'category' = 'PREPARATION'` answers
// "how many failures were preparation?" without inspecting messages.
describe("FAILURE_TAXONOMY — stable, exhaustive catalog", () => {
  it("covers EVERY CreativeJobErrorCode with a category and a stage", () => {
    for (const code of CREATIVE_JOB_ERROR_CODES) {
      const entry = FAILURE_TAXONOMY[code];
      expect(entry, `missing taxonomy entry for ${code}`).toBeDefined();
      expect(FAILURE_CATEGORIES).toContain(entry.category);
      expect(entry.stage.length).toBeGreaterThan(0);
    }
  });

  it("uses only the closed category set approved for #112", () => {
    const approved: FailureCategory[] = [
      "INPUT",
      "SOURCE",
      "PREPARATION",
      "RENDER",
      "QA",
      "STORAGE",
      "COORDINATION",
      "INTERNAL",
    ];
    expect([...FAILURE_CATEGORIES].sort()).toEqual([...approved].sort());
  });

  it("maps the load-bearing codes to the categories the operator queries by", () => {
    expect(FAILURE_TAXONOMY.VIDEO_SOURCE_MISSING.category).toBe("INPUT");
    expect(FAILURE_TAXONOMY.ASSET_DOWNLOAD_FAILED.category).toBe("SOURCE");
    expect(FAILURE_TAXONOMY.VIDEO_PREPARATION_FAILED).toEqual({ category: "PREPARATION", stage: "preparing" });
    expect(FAILURE_TAXONOMY.VIDEO_PREPARED_SOURCE_INVALID).toEqual({ category: "PREPARATION", stage: "preparing" });
    expect(FAILURE_TAXONOMY.SANDBOX_CREATE_FAILED.category).toBe("RENDER");
    expect(FAILURE_TAXONOMY.FONT_STRATEGY_MISMATCH.category).toBe("RENDER");
    expect(FAILURE_TAXONOMY.RENDER_FAILED).toEqual({ category: "RENDER", stage: "rendering" });
    expect(FAILURE_TAXONOMY.RENDER_TIMEOUT).toEqual({ category: "RENDER", stage: "rendering" });
    expect(FAILURE_TAXONOMY.TECHNICAL_QA_FAILED).toEqual({ category: "QA", stage: "qa" });
    expect(FAILURE_TAXONOMY.STORAGE_UPLOAD_FAILED.category).toBe("STORAGE");
    expect(FAILURE_TAXONOMY.STORAGE_VERIFY_FAILED.category).toBe("STORAGE");
    expect(FAILURE_TAXONOMY.ASSET_CREATE_FAILED.category).toBe("STORAGE");
    expect(FAILURE_TAXONOMY.JOB_CANCELLED.category).toBe("COORDINATION");
    expect(FAILURE_TAXONOMY.JOB_ATTEMPTS_EXHAUSTED.category).toBe("COORDINATION");
  });

  it("failureTaxonomyFor: known codes return their entry; unknown strings degrade to INTERNAL (never throws)", () => {
    expect(failureTaxonomyFor("TECHNICAL_QA_FAILED").category).toBe("QA");
    // recoverAbandoned historically wrote a lowercase "timeout" pseudo-code — the lookup
    // must classify it deterministically instead of crashing or guessing.
    expect(failureTaxonomyFor("timeout").category).toBe("INTERNAL");
    expect(failureTaxonomyFor("").category).toBe("INTERNAL");
    expect(failureTaxonomyFor("SOMETHING_NEW").category).toBe("INTERNAL");
  });
});

describe("VIDEO_SOURCE_MISSING joins the shared job catalog (#112 classification fix)", () => {
  it("is a persistable CreativeJobErrorCode", () => {
    expect(CREATIVE_JOB_ERROR_CODES).toContain("VIDEO_SOURCE_MISSING");
  });
  it("is non_retriable — a missing source fails identically on retry (mirrors the video catalog)", () => {
    expect(ERROR_CLASS.VIDEO_SOURCE_MISSING).toBe("non_retriable");
  });
});

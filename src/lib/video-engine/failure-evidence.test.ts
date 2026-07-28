import { describe, expect, it } from "vitest";
import { FailureEvidenceCollector } from "@/lib/video-engine/failure-evidence";

// Issue #112 — the collector accumulates flow facts (strategy, source, sandbox
// identity, per-stage durations) DURING a run so the failed transition can persist a
// complete evidence pack. Doctrine: it NEVER throws — a broken collector must degrade
// to less evidence, never to a failed job.
describe("FailureEvidenceCollector", () => {
  it("records flow facts and returns them in the snapshot", () => {
    const c = new FailureEvidenceCollector(() => 1000);
    c.record({ strategy: "uploaded_video", sourceAssetId: "asset-1" });
    c.record({ preparation: { executed: true, fingerprint: "2:abc", snapshotId: "snap_x", exitCode: 1 } });
    const s = c.snapshot();
    expect(s.strategy).toBe("uploaded_video");
    expect(s.sourceAssetId).toBe("asset-1");
    expect(s.preparation).toMatchObject({ executed: true, fingerprint: "2:abc", snapshotId: "snap_x", exitCode: 1 });
  });

  it("merges nested records instead of clobbering earlier facts", () => {
    const c = new FailureEvidenceCollector(() => 0);
    c.record({ preparation: { executed: true } });
    c.record({ preparation: { sandboxId: "sbx-1" } });
    expect(c.snapshot().preparation).toMatchObject({ executed: true, sandboxId: "sbx-1" });
  });

  it("observeStage closes the previous stage's duration and tracks the current stage", () => {
    let now = 1_000;
    const c = new FailureEvidenceCollector(() => now);
    c.observeStage("download");
    now = 3_500;
    c.observeStage("preparing");
    now = 9_000;
    c.observeStage("rendering");
    const s = c.snapshot();
    expect(s.stage).toBe("rendering");
    expect(s.stageDurationsMs).toEqual({ download: 2500, preparing: 5500 });
    // the stage in flight has no closed duration yet
    expect(s.stageDurationsMs.rendering).toBeUndefined();
  });

  it("snapshot closes the in-flight stage as of 'now' when asked to finalize", () => {
    let now = 100;
    const c = new FailureEvidenceCollector(() => now);
    c.observeStage("preparing");
    now = 700;
    const s = c.snapshot({ finalize: true });
    expect(s.stageDurationsMs.preparing).toBe(600);
  });

  it("NEVER throws: poisoned clock, junk records, junk stages all degrade silently", () => {
    const c = new FailureEvidenceCollector(() => {
      throw new Error("clock broke");
    });
    expect(() => c.observeStage("download")).not.toThrow();
    expect(() => c.record(null as never)).not.toThrow();
    expect(() => c.record({ strategy: "photo_slideshow" })).not.toThrow();
    const s = c.snapshot();
    expect(s.strategy).toBe("photo_slideshow");
    expect(typeof s.stageDurationsMs).toBe("object");
  });

  it("snapshot is JSON-serializable (lands verbatim in transitions.metadata jsonb)", () => {
    const c = new FailureEvidenceCollector(() => 5);
    c.record({ qaDetected: { pixFmt: "yuvj420p", colorRange: "pc", checks: { colorRange: false } } });
    expect(() => JSON.stringify(c.snapshot())).not.toThrow();
    expect(JSON.parse(JSON.stringify(c.snapshot())).qaDetected.colorRange).toBe("pc");
  });
});

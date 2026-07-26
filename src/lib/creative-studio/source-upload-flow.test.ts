import { describe, it, expect } from "vitest";
import {
  validateLocalFile,
  runSourceUpload,
  SourceUploadError,
  type SourceUploadDeps,
  type SourceUploadPhase,
  type LocalFile,
} from "./source-upload-flow";
import { VIDEO_SOURCE_LIMITS } from "@/lib/video-engine/video-source-limits";

const FILE: LocalFile = { name: "clip.mp4", type: "video/mp4", size: 10_000_000 };

describe("validateLocalFile (preventive UX; backend is authority)", () => {
  it("accepts a valid mp4 under the limit", () => {
    expect(validateLocalFile(FILE)).toEqual({ ok: true });
  });
  it("rejects non-mp4 mime / extension / empty / oversized", () => {
    expect(validateLocalFile({ ...FILE, type: "video/quicktime" })).toEqual({ ok: false, error: "invalid_mime" });
    expect(validateLocalFile({ ...FILE, name: "clip.mov" })).toEqual({ ok: false, error: "invalid_extension" });
    expect(validateLocalFile({ ...FILE, size: 0 })).toEqual({ ok: false, error: "empty_file" });
    expect(validateLocalFile({ ...FILE, size: VIDEO_SOURCE_LIMITS.maxFileBytes + 1 })).toEqual({ ok: false, error: "file_too_large" });
  });
});

function deps(over: Partial<SourceUploadDeps> = {}): SourceUploadDeps {
  return {
    initiate: over.initiate ?? (async () => ({ assetId: "a1", bucket: "creative-studio", storagePath: "source/O/L/a1/source.mp4", upload: { signedUrl: "https://signed/x", token: "tok" } })),
    putSignedUrl: over.putSignedUrl ?? (async () => {}),
    complete: over.complete ?? (async () => ({ assetId: "row-1", registered: true })),
  };
}

describe("runSourceUpload — happy path", () => {
  it("runs initiate → upload → complete and reports phases + progress", async () => {
    const phases: SourceUploadPhase[] = [];
    let lastPct = 0;
    const r = await runSourceUpload(
      deps({
        putSignedUrl: async (_u, _t, _f, o) => {
          o.onProgress?.({ sentBytes: 5_000_000, totalBytes: 10_000_000, pct: 50 });
          o.onProgress?.({ sentBytes: 10_000_000, totalBytes: 10_000_000, pct: 100 });
        },
      }),
      { listingId: "L", file: FILE, onPhase: (p) => phases.push(p), onProgress: (p) => (lastPct = p.pct) },
    );
    expect(r.assetId).toBe("row-1");
    expect(phases).toEqual(["validating", "initiating", "uploading", "completing", "registered"]);
    expect(lastPct).toBe(100);
  });
});

describe("runSourceUpload — failures", () => {
  it("local validation failure stops before initiate", async () => {
    let initiated = false;
    await expect(
      runSourceUpload(deps({ initiate: async () => { initiated = true; throw new Error("x"); } }), { listingId: "L", file: { ...FILE, size: 0 } }),
    ).rejects.toMatchObject({ phase: "validating", message: "empty_file" });
    expect(initiated).toBe(false);
  });
  it("initiate failure", async () => {
    await expect(runSourceUpload(deps({ initiate: async () => { throw new Error("init boom"); } }), { listingId: "L", file: FILE })).rejects.toMatchObject({ phase: "initiating" });
  });
  it("upload failure", async () => {
    await expect(runSourceUpload(deps({ putSignedUrl: async () => { throw new Error("net"); } }), { listingId: "L", file: FILE })).rejects.toMatchObject({ phase: "uploading", aborted: false });
  });
  it("upload abort is flagged", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    await expect(runSourceUpload(deps({ putSignedUrl: async () => { throw err; } }), { listingId: "L", file: FILE })).rejects.toMatchObject({ phase: "uploading", aborted: true });
  });
  it("complete failure — 503/audit_not_ensured is retryable", async () => {
    try {
      await runSourceUpload(deps({ complete: async () => { throw new Error("audit_not_ensured (503)"); } }), { listingId: "L", file: FILE });
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SourceUploadError);
      expect((e as SourceUploadError).phase).toBe("completing");
      expect((e as SourceUploadError).retryable).toBe(true);
    }
  });
  it("complete failure — other errors are non-retryable", async () => {
    try {
      await runSourceUpload(deps({ complete: async () => { throw new Error("asset_create_failed"); } }), { listingId: "L", file: FILE });
      throw new Error("should throw");
    } catch (e) {
      expect((e as SourceUploadError).retryable).toBe(false);
    }
  });
});

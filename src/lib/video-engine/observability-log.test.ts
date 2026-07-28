import { afterEach, describe, expect, it, vi } from "vitest";
import { logVideoEvent } from "@/lib/video-engine/observability-log";

// Issue #112 — structured JSON logs for the worker path, following the house pattern
// established by src/lib/ratelimit.ts#logProviderFailure (PR #104): single-line JSON,
// stable `event` discriminator, env + timestamp, redacted free text, and the doctrine
// that observability never throws and never goes silent silently.
describe("logVideoEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits ONE single-line JSON on console.error for error-severity events", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logVideoEvent("video_job_failed", { jobId: "j1", traceId: "t1", errorCode: "RENDER_FAILED" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed.event).toBe("video_job_failed");
    expect(parsed.jobId).toBe("j1");
    expect(parsed.traceId).toBe("t1");
    expect(parsed.errorCode).toBe("RENDER_FAILED");
    expect(typeof parsed.timestamp).toBe("string");
    expect(typeof parsed.env).toBe("string");
  });

  it("routes non-failure events (worker run summary) to console.log", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logVideoEvent("video_worker_run", { claimed: 1, processed: 1, recovered: 0 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0][0] as string).claimed).toBe(1);
  });

  it("redacts URLs and secrets inside string field values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logVideoEvent("video_worker_internal_error", { message: "boom at https://signed.example/u?x=1 sb_secret_LEAK" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.message).not.toContain("signed.example");
    expect(parsed.message).not.toContain("sb_secret_LEAK");
  });

  it("NEVER throws — circular fields degrade to a minimal line, not an exception", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logVideoEvent("video_job_failed", { junk: circular })).not.toThrow();
    expect(spy).toHaveBeenCalled(); // still emitted something rather than going silent
  });
});

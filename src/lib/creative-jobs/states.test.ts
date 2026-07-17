import { describe, it, expect } from "vitest";
import { canTransition, buildTransition } from "@/lib/creative-jobs/states";

describe("canTransition", () => {
  it("allows the happy path (render -> QA -> upload -> completed) and forbids skips", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "rendering")).toBe(true);
    expect(canTransition("rendering", "qa")).toBe(true);
    expect(canTransition("qa", "uploading")).toBe(true);
    expect(canTransition("uploading", "completed")).toBe(true);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
  });

  it("forbids the old (pre-realignment) upload-before-QA order", () => {
    // The render pipeline (produceVideoAsset) does render -> QA -> checksum -> upload
    // -> read-verify -> createAsset, so QA must happen BEFORE upload, not after.
    expect(canTransition("rendering", "uploading")).toBe(false);
    expect(canTransition("uploading", "qa")).toBe(false);
  });

  it("has no outgoing transitions from any terminal state", () => {
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
  });
});

describe("buildTransition", () => {
  it("stamps duration from caller-provided timestamps and carries cost/provider/attempt", () => {
    const t = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "qa", to: "uploading",
      actor: "worker",
      enteredAtMs: 1000, nowMs: 4200, cost: { amountUsd: 0, provider: "remotion" },
      provider: "remotion", capability: "video", attempt: 1,
    });
    expect(t.durationMs).toBe(3200);
    expect(t.provider).toBe("remotion");
    expect(t.costProvider).toBe("remotion");
  });

  it("records an error only on → failed", () => {
    const t = buildTransition({ jobId: "j", listingId: "L", userId: "U", from: "rendering", to: "failed", actor: "worker", enteredAtMs: 0, nowMs: 10, attempt: 2, error: { code: "render_timeout", message: "x" } });
    expect(t.errorCode).toBe("render_timeout");
    expect(t.attempt).toBe(2);
  });

  it("omits errorCode/errorMessage when the transition is not → failed", () => {
    const t = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "queued", to: "running",
      actor: "worker",
      enteredAtMs: 0, nowMs: 5, attempt: 1,
    });
    expect(t.errorCode).toBeNull();
    expect(t.errorMessage).toBeNull();
  });

  it("carries traceId from the input, defaulting to null when omitted", () => {
    const withTrace = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "queued", to: "running",
      actor: "worker", enteredAtMs: 0, nowMs: 5, attempt: 1, traceId: "trace-123",
    });
    expect(withTrace.traceId).toBe("trace-123");

    const withoutTrace = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "queued", to: "running",
      actor: "worker", enteredAtMs: 0, nowMs: 5, attempt: 1,
    });
    expect(withoutTrace.traceId).toBeNull();
  });

  it("carries the actor the caller supplied onto the transition row", () => {
    const seller = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "queued", to: "cancelled",
      actor: "seller", enteredAtMs: 0, nowMs: 5, attempt: 1,
    });
    expect(seller.actor).toBe("seller");

    const system = buildTransition({
      jobId: "j", listingId: "L", userId: "U", from: "running", to: "failed",
      actor: "system", enteredAtMs: 0, nowMs: 5, attempt: 1,
    });
    expect(system.actor).toBe("system");
  });
});

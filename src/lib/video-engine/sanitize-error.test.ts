import { describe, expect, it } from "vitest";
import { sanitizeErrorMessage, sanitizedCauseChain } from "@/lib/video-engine/sanitize-error";

// Issue #112 — the pre-fix sanitizer kept the HEAD (.slice(0,500)) of messages whose
// diagnostic payload (ffmpeg/render stderr) is captured by the TAIL (.slice(-4000)):
// the fatal line, always at the end of stderr, was systematically discarded. The new
// contract: keep the prefix for context AND the tail for the fatal line, redact
// secrets/URLs, cap at 500, and never throw.
describe("sanitizeErrorMessage — tail-preserving truncation", () => {
  it("keeps short messages whole (redacted only)", () => {
    expect(sanitizeErrorMessage(new Error("plain failure"))).toBe("plain failure");
  });

  it("NEVER loses the fatal line at the end of a long stderr-style message", () => {
    const stderrTail = "x".repeat(3800) + "\n[libx264] Error: could not open encoder FATAL_LINE_AT_END";
    const msg = `SandboxRemotionProvider: render failed (exit 1): ${stderrTail}`;
    const out = sanitizeErrorMessage(new Error(msg));
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toContain("FATAL_LINE_AT_END");
    // and keeps the identifying prefix for context
    expect(out).toContain("SandboxRemotionProvider: render failed");
  });

  it("redacts URLs and sb_secret_ tokens in both head and tail", () => {
    const msg =
      `prep failed https://example.com/signed?token=abc ` + "y".repeat(600) + ` end sb_secret_ABCDEF https://leak.example/tail`;
    const out = sanitizeErrorMessage(new Error(msg));
    expect(out).not.toContain("example.com");
    expect(out).not.toContain("sb_secret_ABCDEF");
    expect(out).not.toContain("leak.example");
  });

  it("handles non-Error inputs and never throws", () => {
    expect(sanitizeErrorMessage("just a string")).toBe("just a string");
    expect(sanitizeErrorMessage(null)).toBe("null");
    expect(sanitizeErrorMessage(undefined)).toBe("undefined");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof sanitizeErrorMessage(circular)).toBe("string");
  });
});

describe("sanitizedCauseChain — err.cause is diagnostic depth, not discard", () => {
  it("walks the cause chain, sanitizing each message", () => {
    const root = new Error("ENOTFOUND storage.host https://secret.example/x");
    const mid = new Error("download failed", { cause: root });
    const top = new Error("produce failed", { cause: mid });
    const chain = sanitizedCauseChain(top);
    expect(chain).toHaveLength(2);
    expect(chain[0]).toContain("download failed");
    expect(chain[1]).toContain("ENOTFOUND");
    expect(chain[1]).not.toContain("secret.example");
  });

  it("caps depth (poisoned self-referential cause never loops)", () => {
    const a = new Error("a");
    (a as { cause?: unknown }).cause = a;
    expect(sanitizedCauseChain(a).length).toBeLessThanOrEqual(5);
  });

  it("returns [] for errors without cause and never throws on junk", () => {
    expect(sanitizedCauseChain(new Error("no cause"))).toEqual([]);
    expect(sanitizedCauseChain("string")).toEqual([]);
  });
});

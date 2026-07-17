import { describe, expect, it, vi } from "vitest";
import {
  capturePipelineError,
  registerPipelineSentryClient,
  MAX_SENTRY_MESSAGE_LEN,
  MAX_SENTRY_TAG_VALUE_LEN,
  type PipelineErrorContext,
} from "@/lib/observability/sentry.server";

const CTX: PipelineErrorContext = {
  traceId: "trace-123",
  jobId: "job-456",
  stage: "rendering",
  errorCode: "RENDER_FAILED",
  attempt: 2,
  renderProvider: "vercel-sandbox",
  templateVersion: "1",
};

const ALLOWED_TAG_KEYS = [
  "trace_id",
  "job_id",
  "stage",
  "error_code",
  "attempt",
  "render_provider",
  "template_version",
].sort();

// Realistic examples of what must NEVER appear in a captured payload — a signed
// Supabase Storage URL (query-string token), a property address, and a live-shaped
// secret key (Supabase secret-key format). The secret is assembled at runtime so no
// full sb-secret literal exists in source (avoids GitHub Push Protection false positives);
// runtime value and test behavior are unchanged.
const SIGNED_URL =
  "https://fizhoufepowilbhbtfkg.supabase.co/storage/v1/object/sign/creative-renders/listing-1/video/trace-abc.mp4?token=eyJhbGciOiJIUzI1NiJ9.super-secret-signature";
const PROPERTY_ADDRESS = "123 Ocean Dr, Miami Beach, FL 33139";
const SERVICE_SECRET = ["sb", "secret", "abcdef1234567890"].join("_");

describe("capturePipelineError", () => {
  it("sends exactly the seven allowed technical tags — nothing else", () => {
    const capture = vi.fn();
    capturePipelineError(new Error("boom"), CTX, { captureException: capture });

    expect(capture).toHaveBeenCalledOnce();
    const [, options] = capture.mock.calls[0] as [unknown, { tags: Record<string, unknown> }];
    expect(Object.keys(options.tags).sort()).toEqual(ALLOWED_TAG_KEYS);
    expect(options.tags).toEqual({
      trace_id: "trace-123",
      job_id: "job-456",
      stage: "rendering",
      error_code: "RENDER_FAILED",
      attempt: 2,
      render_provider: "vercel-sandbox",
      template_version: "1",
    });
  });

  it("never includes a sensitive marker (signed URL, address, secret key) in the captured tags", () => {
    const capture = vi.fn();
    // Even if the underlying Error carries sensitive text in its message, the TAGS
    // object this module builds is constructed exclusively from ctx's seven fields —
    // it structurally cannot echo the error message back out.
    const sensitiveErr = new Error(
      `render failed for ${SIGNED_URL} at ${PROPERTY_ADDRESS} using ${SERVICE_SECRET}`,
    );
    capturePipelineError(sensitiveErr, CTX, { captureException: capture });

    const [, options] = capture.mock.calls[0] as [unknown, { tags: Record<string, unknown> }];
    const serializedTags = JSON.stringify(options.tags);
    expect(serializedTags).not.toContain(SIGNED_URL);
    expect(serializedTags).not.toContain(PROPERTY_ADDRESS);
    expect(serializedTags).not.toContain(SERVICE_SECRET);
    expect(serializedTags).not.toContain("sb_secret");
    expect(serializedTags).not.toMatch(/https?:\/\//);
  });

  it("forwards a GENERIC, code-derived message ONLY — never echoes the error's own message, even when it embeds a signed URL, a street address, and a secret key (a regex scrubber cannot reliably catch an address; not echoing anything is the only safe contract)", () => {
    const capture = vi.fn();
    const sensitiveErr = new Error(
      `render failed for ${SIGNED_URL} at ${PROPERTY_ADDRESS} using ${SERVICE_SECRET}`,
    );

    capturePipelineError(sensitiveErr, CTX, { captureException: capture });

    const [forwardedErr] = capture.mock.calls[0] as [unknown, unknown];
    expect(forwardedErr).toBeInstanceOf(Error);
    const forwarded = forwardedErr as Error & { cause?: unknown };

    // Exactly the generic, code-derived string — not merely "doesn't contain PII".
    expect(forwarded.message).toMatch(/^Creative job failed: [A-Z_]+$/);
    expect(forwarded.message).toBe(`Creative job failed: ${CTX.errorCode}`);

    expect(forwarded.message).not.toContain(SIGNED_URL);
    expect(forwarded.message).not.toContain(PROPERTY_ADDRESS);
    expect(forwarded.message).not.toContain(SERVICE_SECRET);
    expect(forwarded.message).not.toContain("sb_secret");
    expect(forwarded.message).not.toMatch(/https?:\/\//);
    expect(forwarded.stack ?? "").not.toContain(SIGNED_URL);
    expect(forwarded.stack ?? "").not.toContain(PROPERTY_ADDRESS);
    expect(forwarded.stack ?? "").not.toContain(SERVICE_SECRET);
  });

  it("never forwards .cause — the forwarded error is built fresh from ctx.errorCode, independent of the original error's message/stack/cause shape", () => {
    const capture = vi.fn();
    const sensitiveErr = new Error(
      `render failed for ${SIGNED_URL} using ${SERVICE_SECRET}`,
    );
    // A PII/address sample smuggled via `.cause` (not `.message`) — since the forwarded
    // error is now built exclusively from `ctx.errorCode`, `.cause` is structurally
    // never read, let alone forwarded, no matter what it contains.
    (sensitiveErr as Error & { cause?: unknown }).cause = {
      address: PROPERTY_ADDRESS,
      secret: SERVICE_SECRET,
    };

    capturePipelineError(sensitiveErr, CTX, { captureException: capture });

    const [forwardedErr] = capture.mock.calls[0] as [unknown, unknown];
    const forwarded = forwardedErr as Error & { cause?: unknown };
    expect(forwarded.cause).toBeUndefined();
    expect(JSON.stringify({ message: forwarded.message, cause: forwarded.cause })).not.toContain(
      PROPERTY_ADDRESS,
    );
  });

  it("also never echoes a bearer token embedded in the error message", () => {
    const capture = vi.fn();
    const sensitiveErr = new Error("upstream call failed: Authorization: Bearer abcdef1234567890");
    capturePipelineError(sensitiveErr, CTX, { captureException: capture });

    const [forwardedErr] = capture.mock.calls[0] as [unknown, unknown];
    const forwarded = forwardedErr as Error;
    expect(forwarded.message).not.toContain("abcdef1234567890");
    expect(forwarded.message).toBe(`Creative job failed: ${CTX.errorCode}`);
  });

  it("handles a null traceId/renderProvider without throwing or injecting null into tags", () => {
    const capture = vi.fn();
    capturePipelineError(new Error("x"), { ...CTX, traceId: null, renderProvider: null }, { captureException: capture });
    const [, options] = capture.mock.calls[0] as [unknown, { tags: Record<string, unknown> }];
    expect(options.tags.trace_id).toBe("");
    expect(options.tags.render_provider).toBe("");
  });

  it("never throws when the client is explicitly absent (null)", () => {
    expect(() => capturePipelineError(new Error("x"), CTX, null)).not.toThrow();
  });

  it("never throws when no client was ever registered (undefined + nothing global)", () => {
    registerPipelineSentryClient(null);
    expect(() => capturePipelineError(new Error("x"), CTX)).not.toThrow();
  });

  it("fails open even if the injected client itself throws", () => {
    const capture = vi.fn(() => {
      throw new Error("sentry transport down");
    });
    expect(() => capturePipelineError(new Error("x"), CTX, { captureException: capture })).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
  });

  it("uses a client registered via registerPipelineSentryClient when none is injected", () => {
    const capture = vi.fn();
    registerPipelineSentryClient({ captureException: capture });
    capturePipelineError(new Error("x"), CTX);
    expect(capture).toHaveBeenCalledOnce();
    registerPipelineSentryClient(null); // reset for other tests in this file
  });

  it("an explicitly-passed null client wins over a registered global (skips capture)", () => {
    const capture = vi.fn();
    registerPipelineSentryClient({ captureException: capture });
    capturePipelineError(new Error("x"), CTX, null);
    expect(capture).not.toHaveBeenCalled();
    registerPipelineSentryClient(null); // reset
  });

  describe("payload size cap", () => {
    it("a huge underlying error message never influences the forwarded message at all — it's ignored, not truncated", () => {
      const capture = vi.fn();
      const hugeMessage = "x".repeat(10_000);
      capturePipelineError(new Error(hugeMessage), CTX, { captureException: capture });

      const [forwardedErr] = capture.mock.calls[0] as [Error, unknown];
      expect(forwardedErr.message).toBe(`Creative job failed: ${CTX.errorCode}`);
      expect(forwardedErr.message).not.toContain(hugeMessage);
      expect(forwardedErr.message.length).toBeLessThanOrEqual(MAX_SENTRY_MESSAGE_LEN);
    });

    it("caps a huge ctx.errorCode within the generic message to MAX_SENTRY_MESSAGE_LEN chars with a truncation marker, never forwarding it raw", () => {
      const capture = vi.fn();
      const hugeErrorCode = "E".repeat(2000);
      capturePipelineError(new Error("x"), { ...CTX, errorCode: hugeErrorCode }, { captureException: capture });

      const [forwardedErr] = capture.mock.calls[0] as [Error, unknown];
      expect(forwardedErr.message.length).toBeLessThanOrEqual(MAX_SENTRY_MESSAGE_LEN);
      expect(forwardedErr.message).not.toBe(`Creative job failed: ${hugeErrorCode}`);
      expect(forwardedErr.message.startsWith("Creative job failed: ")).toBe(true);
      // Truncated, not merely cut off mid-content with no signal that data was dropped.
      expect(forwardedErr.message.endsWith("E")).toBe(false);
    });

    it("never attaches a large stack — a fresh, short stack accompanies the generic message, regardless of what the underlying error carried", () => {
      const capture = vi.fn();
      const hugeMessage = "z".repeat(10_000);
      capturePipelineError(new Error(hugeMessage), CTX, { captureException: capture });

      const [forwardedErr] = capture.mock.calls[0] as [Error, unknown];
      expect(forwardedErr.stack ?? "").not.toContain(hugeMessage);
    });

    it("caps an oversized tag value to MAX_SENTRY_TAG_VALUE_LEN chars", () => {
      const capture = vi.fn();
      const hugeErrorCode = "E".repeat(2000);
      capturePipelineError(new Error("x"), { ...CTX, errorCode: hugeErrorCode }, { captureException: capture });

      const [, options] = capture.mock.calls[0] as [unknown, { tags: Record<string, unknown> }];
      expect(String(options.tags.error_code).length).toBeLessThanOrEqual(MAX_SENTRY_TAG_VALUE_LEN);
    });

    it("leaves a normal-sized generic message and tag values untouched (no over-eager truncation), and never echoes the underlying error's own message", () => {
      const capture = vi.fn();
      capturePipelineError(new Error("boom"), CTX, { captureException: capture });

      const [forwardedErr, options] = capture.mock.calls[0] as [
        Error,
        { tags: Record<string, unknown> },
      ];
      expect(forwardedErr.message).toBe(`Creative job failed: ${CTX.errorCode}`);
      expect(forwardedErr.message).not.toBe("boom");
      expect(options.tags.error_code).toBe("RENDER_FAILED");
    });
  });
});

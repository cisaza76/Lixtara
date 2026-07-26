import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Ratelimit } from "@upstash/ratelimit";
import { clientIp, enforceLimit, apiLimiter } from "@/lib/ratelimit";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://lixtara.vercel.app/api/loui", { headers });
}

describe("clientIp", () => {
  it("returns the first hop of x-forwarded-for", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" }))).toBe(
      "1.2.3.4",
    );
  });

  it("trims whitespace around the first hop", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "  1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIp(reqWith({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
});

// ── Provider-failure containment (incident 2026-07-26) ──────────────────────

const OPTS = { message: "slow down", label: "test" };
const okLimiter = (over: Partial<{ success: boolean; limit: number; remaining: number; reset: number }> = {}) =>
  ({
    limit: async () => ({ success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000, ...over }),
  }) as unknown as Ratelimit;
const throwingLimiter = (err: unknown) =>
  ({
    limit: async () => {
      throw err;
    },
  }) as unknown as Ratelimit;

describe("enforceLimit — normal semantics preserved", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it("1. env vars absent → apiLimiter is null → fail-open (existing doctrine), no throw", async () => {
    // vitest env has no KV_*/UPSTASH_* vars, so the limiter is null.
    const limiter = apiLimiter("test-none", 10, "1 h");
    expect(limiter).toBeNull();
    expect(await enforceLimit(limiter, "id", OPTS)).toBeNull();
  });

  it("2. provider success → proceeds (null), no error log", async () => {
    expect(await enforceLimit(okLimiter(), "id", OPTS)).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("3/10. limit exceeded → 429 with unchanged message + headers semantics", async () => {
    const res = await enforceLimit(
      okLimiter({ success: false, limit: 10, remaining: 0, reset: Date.now() + 30_000 }),
      "id",
      OPTS,
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(await res!.json()).toEqual({ error: "rate_limited", message: "slow down" });
    expect(res!.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res!.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(Number(res!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(errSpy).not.toHaveBeenCalled(); // a real 429 is not a provider failure
  });
});

describe("enforceLimit — provider failure degrades to fail-open (never a 500)", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    vi.useRealTimers();
  });

  const dnsError = () => {
    const cause = new Error("getaddrinfo ENOTFOUND stirred-moray-131131.upstash.io");
    return new TypeError("fetch failed", { cause });
  };

  it("4. DNS/network throw → returns null (no throw to caller) + structured error log", async () => {
    const res = await enforceLimit(throwingLimiter(dnsError()), "id", { ...OPTS, label: "t4" });
    expect(res).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      event: "rate_limit_provider_failure",
      provider: "upstash",
      label: "t4",
      action: "fail_open_bypass",
    });
    expect(logged.failure).toContain("fetch failed");
    expect(typeof logged.timestamp).toBe("string");
  });

  it("5. provider HTTP 500 (thrown by SDK) → degraded, logged", async () => {
    const res = await enforceLimit(throwingLimiter(new Error("Upstash responded with 500")), "id", {
      ...OPTS,
      label: "t5",
    });
    expect(res).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("6. malformed provider response (no boolean success) → degraded, logged", async () => {
    const malformed = { limit: async () => ({ weird: true }) } as unknown as Ratelimit;
    const res = await enforceLimit(malformed, "id", { ...OPTS, label: "t6" });
    expect(res).toBeNull();
    const logged = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(logged.failure).toContain("malformed limiter response");
  });

  it("7. invalid token / 401 from provider → degraded, logged", async () => {
    const res = await enforceLimit(throwingLimiter(new Error("Unauthorized: 401")), "id", {
      ...OPTS,
      label: "t7",
    });
    expect(res).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("8. log never contains a bearer token", async () => {
    await enforceLimit(
      throwingLimiter(new Error("request failed: Authorization: Bearer AXf3supersecrettoken123 rejected")),
      "id",
      { ...OPTS, label: "t8" },
    );
    const raw = errSpy.mock.calls[0][0] as string;
    expect(raw).not.toContain("AXf3supersecrettoken123");
    expect(raw).toContain("Bearer [REDACTED]");
  });

  it("9. log never contains URL credentials or query strings", async () => {
    await enforceLimit(
      throwingLimiter(new Error("GET https://user:hunter2@innocent-x.upstash.io/get?token=abc123 failed")),
      "id",
      { ...OPTS, label: "t9" },
    );
    const raw = errSpy.mock.calls[0][0] as string;
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("abc123");
  });

  it("log-storm protection: repeats within the window are suppressed but counted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    const limiter = throwingLimiter(dnsError());
    await enforceLimit(limiter, "id", { ...OPTS, label: "storm" });
    await enforceLimit(limiter, "id", { ...OPTS, label: "storm" });
    await enforceLimit(limiter, "id", { ...OPTS, label: "storm" });
    expect(errSpy).toHaveBeenCalledTimes(1); // suppressed within the 30s window
    vi.setSystemTime(new Date("2026-07-26T00:00:31Z"));
    await enforceLimit(limiter, "id", { ...OPTS, label: "storm" });
    expect(errSpy).toHaveBeenCalledTimes(2); // at least one signal per window
    const second = JSON.parse(errSpy.mock.calls[1][0] as string);
    expect(second.suppressedSinceLastLog).toBe(2); // the hidden failures are accounted for
  });
});

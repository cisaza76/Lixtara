// Distributed rate limiting via Upstash Redis (provisioned through the Vercel
// Marketplace). Used to cap endpoints that are cheap to call but expensive to
// serve — the Loui LLM relay, and the Stripe / DocuSign external-call routes.
//
// Why Upstash and not an in-memory Map: Fluid Compute reuses and spawns
// multiple function instances, so a per-instance counter leaks. Redis is the
// shared source of truth across every instance and region.
//
// Env vars: the Vercel Upstash Marketplace integration provisions the KV_*
// names (KV_REST_API_URL / KV_REST_API_TOKEN); a manually-created Upstash DB
// uses the UPSTASH_REDIS_REST_* names. We accept either so it works regardless
// of how Redis was provisioned. When neither is present (local dev / CI) the
// limiters return null and callers fail open — see the production guard in
// enforceLimit().

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

function redis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

// Cache limiter instances — building one per request is wasteful and resets
// the in-process ephemeral cache @upstash/ratelimit keeps.
const _cache = new Map<string, Ratelimit>();

/**
 * Sliding-window limiter under `name`, or null when Upstash isn't configured
 * (the caller decides fail-open vs closed via enforceLimit).
 */
export function apiLimiter(
  name: string,
  max: number,
  window: Duration,
): Ratelimit | null {
  const r = redis();
  if (!r) return null;
  const key = `${name}:${max}:${window}`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const limiter = new Ratelimit({
    redis: r,
    prefix: name,
    limiter: Ratelimit.slidingWindow(max, window),
  });
  _cache.set(key, limiter);
  return limiter;
}

export type LouiCaller = "anon" | "user";

/**
 * Loui chat limiter.
 * - `anon`: tight — anonymous visitors are the abuse vector.
 * - `user`: roomier — a real account is behind the request.
 */
export function louiLimiter(kind: LouiCaller): Ratelimit | null {
  return apiLimiter(`loui:${kind}`, kind === "anon" ? 10 : 60, "1 h");
}

/** First hop of x-forwarded-for (Vercel sets this), falling back to x-real-ip. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// ── Provider-failure containment (incident 2026-07-26) ──────────────────────
// The original Marketplace Upstash resource was uninstalled upstream and its
// hostname stopped resolving; `limiter.limit()` then threw `TypeError: fetch
// failed`, which nothing caught — every rate-limited business route (Loui,
// checkout, agreements, staging, tours, video) returned an empty 500. Doctrine
// (owner-approved): an infrastructure failure of the rate-limit PROVIDER must
// degrade to FAIL-OPEN — the route proceeds unprotected — with a loud,
// structured, secret-free log. It must never be the cause of a 5xx, and it is
// never silent. This mirrors the existing fail-open for "not configured".

const PROVIDER_FAILURE_LOG_THROTTLE_MS = 30_000;
// Per-instance throttle state. Fluid Compute reuses instances, so this
// meaningfully dedups a failure storm; a fresh instance logging once more is
// acceptable (at least one signal per instance per window, never zero).
const _providerFailureLog = new Map<string, { lastLoggedAt: number; suppressed: number }>();

// Defense-in-depth: provider error messages should never carry credentials,
// but redact anything token-shaped before logging just in case.
function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9_\-+/=.]+/g, "Bearer [REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s@]*@/g, "$1[REDACTED]@")
    .replace(/\?[^\s"']+/g, "?[REDACTED]");
}

function describeProviderFailure(err: unknown): string {
  const raw =
    err instanceof Error
      ? `${err.name}: ${err.message}${err.cause instanceof Error ? ` (cause: ${err.cause.message})` : ""}`
      : String(err);
  return redactSecrets(raw).slice(0, 300);
}

function logProviderFailure(label: string, err: unknown): void {
  const now = Date.now();
  const state = _providerFailureLog.get(label);
  if (state && now - state.lastLoggedAt < PROVIDER_FAILURE_LOG_THROTTLE_MS) {
    state.suppressed += 1;
    return;
  }
  const suppressedSinceLastLog = state?.suppressed ?? 0;
  _providerFailureLog.set(label, { lastLoggedAt: now, suppressed: 0 });
  console.error(
    JSON.stringify({
      event: "rate_limit_provider_failure",
      provider: "upstash",
      label,
      failure: describeProviderFailure(err),
      action: "fail_open_bypass",
      env: process.env.VERCEL_ENV ?? "development",
      timestamp: new Date().toISOString(),
      suppressedSinceLastLog,
    }),
  );
}

/**
 * Consume one token for `id`. Returns a ready-to-send 429 Response when the
 * caller is over the limit, or null to proceed. When Upstash isn't configured
 * we fail open — but log loudly in production so an unprotected endpoint can't
 * ship silently.
 *
 * PROVIDER FAILURE (configured but unreachable/broken): also fail open, with a
 * structured `rate_limit_provider_failure` error log — the limiter must never
 * be the reason a business route returns 5xx (incident 2026-07-26). The caller
 * signature is unchanged; the log is the bypass signal.
 */
export async function enforceLimit(
  limiter: Ratelimit | null,
  id: string,
  opts: { message: string; label: string },
): Promise<Response | null> {
  if (!limiter) {
    if (process.env.VERCEL_ENV === "production") {
      console.error(
        `${opts.label}: Upstash not configured in production — endpoint is UNRATELIMITED`,
      );
    }
    return null;
  }
  let outcome: Awaited<ReturnType<Ratelimit["limit"]>>;
  try {
    outcome = await limiter.limit(id);
  } catch (err) {
    logProviderFailure(opts.label, err);
    return null; // fail-open: infra failure is degraded, logged, and never a 500
  }
  if (typeof outcome?.success !== "boolean") {
    // Malformed provider response — same doctrine as a thrown failure.
    logProviderFailure(opts.label, new Error(`malformed limiter response (${typeof outcome})`));
    return null;
  }
  const { success, limit, remaining, reset } = outcome;
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return Response.json(
    { error: "rate_limited", message: opts.message },
    {
      status: 429,
      headers: {
        "retry-after": String(retryAfter),
        "x-ratelimit-limit": String(limit),
        "x-ratelimit-remaining": String(remaining),
      },
    },
  );
}

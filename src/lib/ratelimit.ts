// Distributed rate limiting via Upstash Redis (provisioned through the Vercel
// Marketplace). Used to cap endpoints that are cheap to call but expensive to
// serve — the Loui LLM relay, and the Stripe / DocuSign external-call routes.
//
// Why Upstash and not an in-memory Map: Fluid Compute reuses and spawns
// multiple function instances, so a per-instance counter leaks. Redis is the
// shared source of truth across every instance and region.
//
// Env vars (set by the Upstash Marketplace integration):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// When they're absent (local dev / CI) the limiters return null and callers
// fail open — see the production guard in enforceLimit().

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

function redis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
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

/**
 * Consume one token for `id`. Returns a ready-to-send 429 Response when the
 * caller is over the limit, or null to proceed. When Upstash isn't configured
 * we fail open — but log loudly in production so an unprotected endpoint can't
 * ship silently.
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
  const { success, limit, remaining, reset } = await limiter.limit(id);
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

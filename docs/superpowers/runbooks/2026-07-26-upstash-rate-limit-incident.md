# Rate Limiting (Upstash) — Incident Record & Operational Runbook

## Incident record — 2026-07-26

- **Root cause:** the original Vercel Marketplace Upstash resource (`upstash-kv-aero-school`,
  host `stirred-moray-…upstash.io`) was **uninstalled upstream** (it shows `Uninstalled` in
  `vercel integration list`); its hostname stopped resolving (NXDOMAIN). The production
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` kept pointing at the dead host. `enforceLimit` only
  failed open when Upstash was NOT configured; with a configured-but-dead host,
  `limiter.limit()` threw `TypeError: fetch failed` and nothing caught it → the route
  returned an **empty 500**.
- **Detection:** 2026-07-26, during the Gate 2 activation smoke of the uploaded-video
  feature — `POST /api/creative-studio/video/source/initiate` returned 500; runtime logs
  showed `getaddrinfo ENOTFOUND`. The Gate 2 kill-switch was executed per protocol.
- **Failure reproduced on:** `POST /api/loui` (500 in production, confirmed live).
- **Potentially affected routes** (every `enforceLimit` consumer): loui, checkout ×4
  (tier / consultation / photography / staging-overage), agreement create/sync, staging
  generate, tours submit, media-agent generate, creative-studio video generate +
  source initiate/complete.
- **Real impact: not quantified** — Sentry is not wired for these routes, and Vercel log
  retention is short. Last known-good verification of the limiters was 2026-05-20. Do not
  claim affected users without evidence.
- **Immediate mitigation (Phase A, same day):** dead env vars removed; new Marketplace
  resource **`lixtara-prod-ratelimit`** (Upstash for Redis) provisioned and connected —
  env vars auto-created for Production/Preview/Development; production redeployed.
  Verified: Loui 500→200, controlled 429 reached at request 10/12 (anon limit 10/h),
  SET/GET/DEL round-trip with a temporary key (deleted afterwards).
- **Permanent fix (this PR):** `enforceLimit` provider-failure containment — see below.
- **Follow-up (open):** wire Sentry (`SENTRY_DSN`) so a provider failure alerts instead of
  relying on log inspection; consider a periodic synthetic check of a rate-limited route.

## How rate limiting works

- **Module:** `src/lib/ratelimit.ts`. Consumers call `enforceLimit(apiLimiter(...), id, opts)`.
- **Env vars:** `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Marketplace names) or
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (manual names) — either pair works.
  Managed by the Marketplace integration; do not hand-edit unless rotating.
- **Not configured** (vars absent — local dev/CI): limiters are `null` → **fail-open**;
  in production a plain `console.error` marks the endpoint as UNRATELIMITED.
- **Configured but provider fails** (DNS, network, 401, 5xx, malformed response):
  **fail-open** — the route proceeds unprotected and a structured, throttled, secret-free
  error log is emitted (`event: "rate_limit_provider_failure"`, includes label, provider,
  redacted failure, env, timestamp, suppressed count; at most one log per label per 30s per
  instance, with suppressed repeats counted). The limiter is never the cause of a 5xx and
  is never silently bypassed.

## Diagnostics

1. Symptom scan: `vercel logs <prod-deployment>` — look for
   `rate_limit_provider_failure` (post-fix) or `fetch failed` / `ENOTFOUND` (pre-fix).
2. Resource health: `vercel integration list` → the resource must be `● Available`
   (an `Uninstalled` row is the 2026-07-26 failure mode).
3. Connectivity (no secrets printed): pull env to a THROWAWAY file outside the repo with
   `vercel env pull <file> --environment=production`, then
   `curl $KV_REST_API_URL/set/healthcheck_tmp/ok/ex/60 -H "Authorization: Bearer $KV_REST_API_TOKEN"`
   → expect `{"result":"OK"}`; `…/del/healthcheck_tmp` afterwards; delete the file.
4. Controlled 429 proof: POST `/api/loui` anonymously with a junk body until the first 429
   (anon limit 10/h per IP) — stop at the first 429; this consumes your own IP's window.
5. DNS never applies to psql/session-pooler guidance — that is Supabase SQL, not Redis.

## Credential rotation / recovery

- Rotate: Upstash dashboard (via `vercel integration open upstash/upstash-kv`) → rotate
  REST token → integration updates env vars → redeploy Production (env is baked per
  deployment).
- Recovery from provider loss: provision a fresh Marketplace resource
  (`vercel integration add upstash/upstash-kv -n <name>`), remove stale KV_* vars first to
  avoid name collisions, redeploy, verify (steps 2–4 above).
- Eviction note: the Marketplace-billed resource is not the legacy standalone free tier;
  still, keep the resource attached to the project and review the plan in the Upstash
  dashboard so an inactivity policy can never delete it silently again.

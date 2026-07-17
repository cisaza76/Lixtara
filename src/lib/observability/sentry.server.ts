// Sanitized Sentry capture for the Creative Studio video pipeline (Gate C1 — docs/
// superpowers/plans/2026-07-15-creative-studio-p2-video.md, "Sentry in code (no DSN
// required in C1)"). This module sends ONLY seven technical tags — trace_id, job_id,
// stage, error_code, attempt, render_provider, template_version — plus a GENERIC,
// code-derived exception message ("Creative job failed: <ERROR_CODE>"). It never
// forwards the caller's error message/stack/cause at all.
//
// Gate C2 finding: a regex scrubber (URL / `sb_secret_` / bearer-token patterns) cannot
// reliably catch every leak shape — a thrown error whose message embeds a street
// address, for example, sails straight through it. There is no reliable way to
// pattern-match "is this string PII" in general, so the only structurally safe contract
// is to never echo ANY of the caller's error content to Sentry, sanitized or not. This
// module therefore builds the forwarded exception EXCLUSIVELY from `ctx.errorCode` (one
// of the seven allowed structured fields) and ignores the `err` argument's content
// entirely — `err` exists only to satisfy `captureException`'s calling convention.
// Callers (src/lib/video-engine/pipeline.ts) still sanitize their own message for the
// DB's `creative_jobs.error_message` column (an admin/support-only field, not the same
// leak surface as a third-party observability vendor) — that path is unrelated and
// unchanged.
//
// Fail-open, like src/lib/ratelimit.ts: observability must never break the pipeline.
// No `@sentry/nextjs` dependency is required to import or call this module — a real
// Sentry client is only ever used if one is injected (tests) or has registered itself
// globally via `registerPipelineSentryClient`. Gate D1 wires that registration in the
// repo-root `instrumentation.ts`, gated on `SENTRY_DSN` being set — provisioning that
// DSN in a real environment is still an owner action (see the production-readiness
// checklist), so `registeredClient` stays `null` (this module keeps no-oping) in every
// environment until then.

export interface PipelineErrorContext {
  traceId: string | null;
  jobId: string;
  stage: string;
  errorCode: string;
  attempt: number;
  renderProvider: string | null;
  templateVersion: string;
}

// Minimal, structural surface — deliberately NOT `@sentry/nextjs`'s own client type, so
// this module has no hard dependency on that package (unconfigured in C1). Any object
// shaped like this (including a real `Sentry` module import, which exposes the same
// method) satisfies it.
export interface SentryLikeClient {
  captureException(error: unknown, context?: { tags?: Record<string, string | number> }): unknown;
}

// Set once by production `instrumentation.ts` after `@sentry/nextjs` is initialized
// (out of C1's scope — no DSN is configured anywhere yet). Left `null` here means every
// call in every current environment fails open silently, exactly like an unconfigured
// Upstash limiter.
let registeredClient: SentryLikeClient | null = null;

export function registerPipelineSentryClient(client: SentryLikeClient | null): void {
  registeredClient = client;
}

function resolveClient(injected: SentryLikeClient | null | undefined): SentryLikeClient | null {
  // Explicit `null`/client passed in wins outright (tests rely on this to force the
  // "absent" path even if a global happens to be registered). `undefined` means "use
  // whatever's registered" — the real production path.
  if (injected !== undefined) return injected;
  return registeredClient;
}

// Payload-size cap: this module must never forward a huge payload to Sentry — not a
// full manifest, not full metadata, not a giant stack, and not an unbounded error
// message. Two limits: the generic message (short by construction, but capped anyway
// since `ctx.errorCode` is technically caller-supplied) and each individual tag value
// (tags are meant to be short technical identifiers, not free text).
export const MAX_SENTRY_MESSAGE_LEN = 500;
export const MAX_SENTRY_TAG_VALUE_LEN = 200;
const TRUNCATION_MARKER = "…[truncated]";

// Truncates `s` to at most `maxLen` characters, appending `TRUNCATION_MARKER` (never
// silently cutting content off without signaling that data was dropped) whenever
// truncation actually happens. Below the limit, `s` is returned untouched.
function capLength(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const keep = Math.max(0, maxLen - TRUNCATION_MARKER.length);
  return s.slice(0, keep) + TRUNCATION_MARKER;
}

// Applied to every outgoing tag value — `ctx`'s fields are meant to be short technical
// identifiers (a job id, an error code, a template version), but nothing upstream
// actually bounds their length, so this is the backstop that keeps a rogue/oversized tag
// value from ballooning the payload. Numbers (only `attempt`) pass through untouched.
function capTagValue<T extends string | number>(value: T): T {
  if (typeof value !== "string") return value;
  return capLength(value, MAX_SENTRY_TAG_VALUE_LEN) as T;
}

// The ONLY exception message Sentry ever sees. Built exclusively from `ctx.errorCode` —
// a stable, structured `CreativeJobErrorCode` string, never from the caller's `err`
// (see the module doc comment above for why: no regex scrubber can reliably catch every
// PII shape, so the only safe contract is to never echo error-derived text at all). A
// fresh `Error` is constructed here, so its `.stack` is captured at THIS call site and
// its `.cause` is never set — neither can smuggle the original error's raw detail.
function buildGenericError(ctx: PipelineErrorContext): Error {
  return new Error(capLength(`Creative job failed: ${ctx.errorCode}`, MAX_SENTRY_MESSAGE_LEN));
}

// Never throws — not even if the injected/registered client itself throws
// (a misbehaving Sentry SDK must not take down the render pipeline it's trying to
// observe).
//
// `err` is accepted (matching `captureException`'s conventional first argument and
// giving callers a natural call shape) but its content — message, stack, cause, name,
// anything — is NEVER read. See `buildGenericError`: the forwarded exception is built
// exclusively from `ctx.errorCode`. This is intentional, not an oversight: keeping the
// parameter but ignoring it means a future caller cannot accidentally leak PII by
// passing a richer error, because there is structurally no code path here that reads it.
export function capturePipelineError(
  err: unknown,
  ctx: PipelineErrorContext,
  client?: SentryLikeClient | null,
): void {
  void err;
  try {
    const target = resolveClient(client);
    if (!target) return;

    // Exactly these seven keys — no spread of `ctx`, no forwarding of `err.message`/
    // `err.stack`/anything else, so this object structurally cannot carry more than the
    // allowed tag set even if `ctx` itself is ever widened by a future caller. Each
    // string value is also length-capped (`capTagValue`) so an unexpectedly large tag
    // value can't balloon the payload either.
    const tags: Record<string, string | number> = {
      trace_id: capTagValue(ctx.traceId ?? ""),
      job_id: capTagValue(ctx.jobId),
      stage: capTagValue(ctx.stage),
      error_code: capTagValue(ctx.errorCode),
      attempt: ctx.attempt,
      render_provider: capTagValue(ctx.renderProvider ?? ""),
      template_version: capTagValue(ctx.templateVersion),
    };

    target.captureException(buildGenericError(ctx), { tags });
  } catch {
    // Fail-open: an observability failure must never surface to the caller.
  }
}

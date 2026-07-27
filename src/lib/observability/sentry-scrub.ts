// Sentry event/breadcrumb scrubbing (P1 pre-Gate-5). Pure, runtime-agnostic (node/edge/
// client) so every Sentry.init shares EXACTLY the same privacy contract and it is unit-testable
// without the SDK.
//
// Doctrine: strip whole CATEGORIES structurally (cookies, request bodies, auth headers, query
// strings) rather than trying to pattern-match every possible secret — the sentry.server.ts
// Gate-C2 finding stands: "is this string PII?" is not reliably decidable, so anything that
// routinely CARRIES secrets is dropped wholesale. Pattern redaction is applied ON TOP of that,
// as defense in depth, to free-text fields we deliberately keep (exception messages,
// breadcrumb messages) because their operational value outweighs the residual risk once
// token-shaped content is masked.
//
// Kept (operational value): error type, redacted exception message, stack frames, route/path
// (query-stripped), runtime, environment, release, redacted breadcrumb trail, tags set by our
// own code (capturePipelineError's seven technical tags are already content-free).

const HEADER_ALLOWLIST = new Set([
  "host",
  "user-agent",
  "content-type",
  "content-length",
  "accept",
  "accept-language",
  "referer", // query-stripped below
  "x-vercel-id", // request correlation — an ID, not a credential
]);

// Token-shaped content inside free text. Order matters: URLs first (so their query strings go
// away before token patterns run on the remainder).
export function redactSensitiveText(text: string): string {
  return (
    text
      // any URL query string (signed URLs, magic links, verify links, X-Amz signatures, …)
      .replace(/\?[^\s"'<>)\]]+/g, "?[REDACTED]")
      // auth URL fragments (#access_token=…)
      .replace(/#[^\s"'<>)\]]*(token|code)[^\s"'<>)\]]*/gi, "#[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9_\-+/=.]+/g, "Bearer [REDACTED]")
      // Supabase key families + personal access tokens
      .replace(/\bsb(?:p|_secret|_publishable)_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
      // JWT triplets
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
      // email addresses (never ship full emails — found live during the P1 production smoke)
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
  );
}

function redactUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?[REDACTED]`;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Sentry event shapes are structural JSON;
   typing against the SDK would defeat the module's SDK-independence. */

function scrubHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!headers) return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HEADER_ALLOWLIST.has(k.toLowerCase())) continue; // cookie/authorization/apikey/etc. dropped
    out[k] = typeof v === "string" ? redactSensitiveText(v) : v;
  }
  return out;
}

function deepRedact(value: any, depth = 0): any {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRedact(v, depth + 1);
    return out;
  }
  return value;
}

// beforeSend — shared by every runtime init. Returning the mutated event keeps delivery;
// events that are not objects are dropped outright.
export function scrubEvent<E extends object>(event: E): E | null {
  if (!event || typeof event !== "object") return null;
  const ev = event as Record<string, any>;

  const req = ev.request as Record<string, any> | undefined;
  if (req) {
    delete req.cookies; // never
    delete req.data; // request bodies (Loui messages, form posts) — never
    req.headers = scrubHeaders(req.headers as Record<string, unknown> | undefined);
    if (typeof req.query_string === "string" && req.query_string.length > 0) req.query_string = "[REDACTED]";
    if (typeof req.url === "string") req.url = redactUrl(req.url);
  }
  delete ev.user; // no user objects (email/id/ip) — correlation stays in our own tags

  if (ev.extra) ev.extra = deepRedact(ev.extra);
  if (ev.contexts) ev.contexts = deepRedact(ev.contexts);
  if (ev.tags) ev.tags = deepRedact(ev.tags);

  const values = ev.exception?.values;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (typeof v?.value === "string") v.value = redactSensitiveText(v.value);
    }
  }
  if (typeof ev.message === "string") ev.message = redactSensitiveText(ev.message);

  return event;
}

// beforeBreadcrumb — same doctrine per breadcrumb; fetch/xhr breadcrumbs keep method/status
// but lose query strings and any token-shaped content.
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B | null {
  if (!breadcrumb || typeof breadcrumb !== "object") return null;
  const bc = breadcrumb as Record<string, any>;
  if (typeof bc.message === "string") bc.message = redactSensitiveText(bc.message);
  if (bc.data && typeof bc.data === "object") {
    const data = bc.data as Record<string, any>;
    if (typeof data.url === "string") data.url = redactUrl(data.url);
    delete data.body;
    delete data.request_body;
    delete data.response_body;
    bc.data = deepRedact(data);
  }
  return breadcrumb;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

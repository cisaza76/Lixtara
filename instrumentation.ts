// Next.js instrumentation hook (App Router). Runs once per server runtime instance, before
// any route/worker code.
//
// P1 pre-Gate-5 (2026-07-27): extends the original Gate-D1 wiring (server-only, pipeline-only)
// into full production error observability, still FAIL-OPEN by construction — with no DSN this
// module no-ops and nothing breaks. DSN resolution accepts both names: `SENTRY_DSN`
// (server-only, the original contract) and `NEXT_PUBLIC_SENTRY_DSN` (the canonical variable
// the Vercel Marketplace Sentry integration provisions — a DSN is a public identifier by
// design, not a secret).
//
// Coverage: nodejs runtime + edge runtime inits, `onRequestError` (Next's server hook — this
// is what turns route-handler crashes like the 2026-07-26 Upstash/Loui empty-500s into
// visible events), and the pipeline's `capturePipelineError` registration (nodejs only, as
// before). Client capture lives in `instrumentation-client.ts`; the React boundary in
// `src/app/global-error.tsx`. Every init shares the same scrubbing contract
// (src/lib/observability/sentry-scrub.ts): no cookies, no auth headers, no request bodies, no
// query strings, no user objects, token-shaped content masked — see that module's doctrine.
import { scrubEvent, scrubBreadcrumb } from "@/lib/observability/sentry-scrub";

function resolveDsn(): string | undefined {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
}

function sharedInitOptions(dsn: string) {
  return {
    dsn,
    // Error capture only — no performance tracing (unchanged doctrine).
    tracesSampleRate: 0,
    // Never send default PII (IP address, cookies, headers).
    sendDefaultPii: false,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

export async function register(): Promise<void> {
  const dsn = resolveDsn();
  if (!dsn) return; // no-op: DSN not provisioned in this environment

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [Sentry, { registerPipelineSentryClient }] = await Promise.all([
      import("@sentry/nextjs"),
      import("@/lib/observability/sentry.server"),
    ]);
    Sentry.init(sharedInitOptions(dsn));
    registerPipelineSentryClient(Sentry);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init(sharedInitOptions(dsn));
  }
}

// Next.js server request-error hook: captures uncaught route-handler / server-component
// errors (the class of failure that was previously invisible — empty 500s). Fail-open: no
// DSN → no-op; a Sentry import/report failure must never affect the response.
export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
): Promise<void> {
  if (!resolveDsn()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(...args);
  } catch {
    // observability must never break the request path
  }
}

// Next.js instrumentation hook (App Router, stable since Next 15 — no config flag
// needed). Runs once per server runtime instance, before any route/worker code.
//
// Gate D1 (docs/superpowers/plans/2026-07-15-creative-studio-p2-video.md, Task 7):
// initializes @sentry/nextjs ONLY when SENTRY_DSN (server-only env var — see
// CLAUDE.md's "Environment variables" section) is actually set, and registers the
// initialized client with src/lib/observability/sentry.server.ts's
// `capturePipelineError` fallback so pipeline errors reach Sentry once a DSN exists.
//
// Fail-open by construction: in every environment where SENTRY_DSN is unset (every
// environment as of this commit — provisioning a DSN is an owner action, see the
// production-readiness checklist), `register()` returns immediately and does nothing.
// `capturePipelineError` already tolerates `registeredClient` staying `null` forever
// (it no-ops), so a missing DSN is never a startup error, never a build error, and
// never breaks the render pipeline.
//
// Deliberately narrow scope: this wires SERVER-SIDE error capture for the Creative
// Studio pipeline only (the one thing Gate D1 asks for). Broader Next.js Sentry
// integration — client-side capture, source-map upload via `withSentryConfig`,
// request-error instrumentation (`onRequestError`), performance tracing — is out of
// scope here; there is no UI in P2 yet (Gate D2, deferred) and no other caller of
// `capturePipelineError` outside the video pipeline.
export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // no-op: DSN not provisioned in this environment (owner action)

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [Sentry, { registerPipelineSentryClient }] = await Promise.all([
      import("@sentry/nextjs"),
      import("@/lib/observability/sentry.server"),
    ]);

    Sentry.init({
      dsn,
      // Error capture only — no performance tracing in Gate D1's scope.
      tracesSampleRate: 0,
      // Never send default PII (IP address, cookies, headers) — matches
      // sentry.server.ts's own discipline of never forwarding error-derived content.
      sendDefaultPii: false,
    });

    registerPipelineSentryClient(Sentry);
  }
}

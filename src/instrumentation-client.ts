// Client-side Sentry init (P1 pre-Gate-5). Next.js loads this file in the browser bundle
// automatically (App Router instrumentation-client convention). Fail-open: without
// NEXT_PUBLIC_SENTRY_DSN (inlined at build time) nothing initializes.
//
// Same privacy contract as the server/edge inits — shared scrubbers, sendDefaultPii=false,
// no tracing. A DSN is a public identifier by design; no secret reaches the bundle.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubBreadcrumb } from "@/lib/observability/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

// Required client hook export for @sentry/nextjs v10 navigation instrumentation. With
// tracing disabled it is inert, but exporting it keeps the SDK contract satisfied.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

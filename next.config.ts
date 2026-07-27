import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB. Step 5 (Photos) lets sellers upload 5+ photos per
      // submit; we cap individual files at 10MB via the bucket, but the
      // combined multi-file FormData can run to ~30MB.
      bodySizeLimit: "30mb",
    },
  },
  images: {
    remotePatterns: [
      // Property photos — Unsplash placeholders during F1b; swap to Supabase
      // Storage in F2 when sellers upload real photos.
      { protocol: "https", hostname: "images.unsplash.com" },
      // Supabase Storage public bucket (F2+).
      {
        protocol: "https",
        hostname: "fizhoufepowilbhbtfkg.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

// P1 pre-Gate-5: private source maps + release association via the official Sentry build
// wrapper. FAIL-OPEN: when SENTRY_AUTH_TOKEN/ORG/PROJECT are absent (local dev, forks) the
// plugin skips the upload with a warning — the build never breaks because of Sentry.
// `sourcemaps.deleteSourcemapsAfterUpload` keeps the maps PRIVATE: uploaded to Sentry, then
// removed from the deploy output so they are never publicly served. The auth token is
// consumed at BUILD time only — it is never read by runtime code and never reaches a bundle.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
});

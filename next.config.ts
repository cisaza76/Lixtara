import type { NextConfig } from "next";

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

export default nextConfig;

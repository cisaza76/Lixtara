import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

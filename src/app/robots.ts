import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { locales } from "@/lib/i18n";
import { PRIVATE_SECTIONS } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Previews and local dev must never be indexed (they share content with lixtara.com).
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        ...locales.flatMap((l) => PRIVATE_SECTIONS.map((s) => `/${l}/${s}`)),
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

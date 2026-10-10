import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { locales } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates } from "@/lib/seo";

// Public, indexable pages. /about is left out while it shows "Coming soon".
const STATIC_PATHS = [
  "/contact",
  "",
  "/properties",
  "/services",
  "/consultations",
  "/privacy",
  "/terms",
  "/cookies",
  "/disclaimers",
  "/dmca",
];

export const revalidate = 3600;

async function activePropertyIds(): Promise<{ id: string; updated: Date }[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("properties")
      .select("id,created_at")
      .eq("mls_status", "active")
      .eq("is_test", false);
    return (data ?? []).map((r) => ({ id: r.id as string, updated: new Date(r.created_at as string) }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = (path: string, lastModified?: Date): MetadataRoute.Sitemap =>
    locales.map((lang) => {
      const alt = localeAlternates(`/${lang}${path}`, SITE_URL);
      return { url: alt.canonical, lastModified, alternates: { languages: alt.languages } };
    });

  const properties = await activePropertyIds();
  return [
    ...STATIC_PATHS.flatMap((p) => entries(p)),
    ...properties.flatMap((p) => entries(`/property/${p.id}`, p.updated)),
  ];
}

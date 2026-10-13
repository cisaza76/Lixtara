import { locales } from "@/lib/i18n";

// Request header the proxy sets with the request pathname, so the root layout can
// emit canonical + hreflang for whatever page is rendering.
export const PATHNAME_HEADER = "x-lixtara-pathname";

// Logged-in / transactional areas: kept out of search (robots.txt) and the sitemap.
export const PRIVATE_SECTIONS = ["admin", "dashboard", "account", "listing", "auth", "sign-in", "sign-up"];

/**
 * Canonical + hreflang for a localized path. `/es/services?x=1` →
 * canonical `${siteUrl}/es/services`, alternates en/es and x-default (English).
 * The query string is dropped so filtered/tracked URLs fold into one canonical.
 */
export function localeAlternates(pathname: string, siteUrl: string) {
  const clean = pathname.split(/[?#]/)[0];
  const [, first = "", ...rest] = clean.split("/");
  const lang = (locales as readonly string[]).includes(first) ? first : "en";
  const tail = rest.filter(Boolean).join("/");
  const url = (l: string) => `${siteUrl}/${l}${tail ? `/${tail}` : ""}`;
  const languages: Record<string, string> = Object.fromEntries(locales.map((l) => [l, url(l)]));
  languages["x-default"] = url("en");
  return { canonical: url(lang), languages };
}

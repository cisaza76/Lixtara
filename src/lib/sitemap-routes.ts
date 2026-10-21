// Public, indexable pages: the one list the sitemap is built from (src/app/sitemap.ts), one entry
// per locale with hreflang en, es and x-default. Each path is a page under src/app/[lang].
// Left out on purpose: the cold-email owners landing (noindex), PRIVATE_SECTIONS (session or
// transactional, src/lib/seo.ts) and /property/[id] (added per active listing by the sitemap).
// sitemap-routes.test.ts fails if a path here is noindex, private or has no page, and if a new
// page under src/app/[lang] is neither listed here nor excluded there.
export const SITEMAP_PATHS = [
  "",
  "/about",
  "/properties",
  "/services",
  "/consultations",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
  "/disclaimers",
  "/notices",
  "/accessibility",
  "/dmca",
] as const;

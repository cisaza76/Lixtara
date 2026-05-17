// Site config — single source for absolute URLs used in email redirects,
// OG tags, and JSON-LD. Defaults to localhost for dev; NEXT_PUBLIC_SITE_URL
// is set in Vercel for prod/preview.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

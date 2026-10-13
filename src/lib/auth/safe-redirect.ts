// Safe post-auth redirect resolution (P3, 2026-07-27). The OAuth/magic-link callback receives
// a user-controlled `next` query param and previously redirected via STRING concatenation
// (`${origin}${next}`), which lets an attacker escape the origin — e.g. `next=@evil.com`
// makes `https://lixtara.com@evil.com`, whose host is `evil.com` (userinfo trick). Supabase's
// redirect allow-list does NOT cover this: `next` is consumed INSIDE our callback, after
// Supabase has already redirected to the (allow-listed) callback URL.
//
// Contract: resolve `next` against our own origin and return it ONLY if it stays on that
// origin; otherwise fall back to a safe default path. Returns a RELATIVE path (pathname +
// search + hash) so the caller builds the final URL from a trusted base — never raw
// concatenation.

// Only same-origin relative destinations are honored. Everything else (absolute externals,
// protocol-relative `//host`, userinfo `@host`, look-alikes, malformed) collapses to fallback.
export function safeNextPath(next: string | null | undefined, origin: string, fallback = "/"): string {
  if (!next) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(next, origin); // relative paths resolve onto origin; absolutes keep their own
  } catch {
    return fallback; // unparseable (double-encoded junk, control chars, …)
  }
  if (resolved.origin !== origin) return fallback; // different scheme/host/port → reject
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  // Defense in depth: a resolved same-origin path must still begin with a single "/". Reject
  // anything that somehow normalized to a protocol-relative or scheme-bearing shape.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  return path;
}

// Post-login destinations are often passed without a locale (`?next=/account`,
// `?next=/listing/new`). The proxy sends unprefixed paths to the DEFAULT locale,
// so a Spanish user would land on the English page. Keep the user's language.
export function withLocale(path: string, lang: string): string {
  if (/^\/(en|es)(\/|$|\?|#)/.test(path)) return path;
  return `/${lang}${path === "/" ? "" : path}`;
}

// Staff (admin/broker) who sign in without a specific destination land on the admin
// panel, not the public home page. An explicit `next` (e.g. a deep link into /admin or
// a property) is still honored.
export function postSignInPath(next: string, lang: string, staff: boolean): string {
  const path = withLocale(next, lang);
  if (!staff) return path;
  const bare = path.replace(/[?#].*$/, "").replace(/\/$/, "");
  if (bare === `/${lang}` || bare === `/${lang}/dashboard`) return `/${lang}/admin`;
  return path;
}

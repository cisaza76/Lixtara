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

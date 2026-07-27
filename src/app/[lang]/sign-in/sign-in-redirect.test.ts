// Pins the sign-in action's post-auth redirect contract: it feeds the user-controlled `next`
// (from the ?next= query param, via a hidden field) through safeNextPath before redirect(), so
// a crafted sign-in link cannot bounce a just-authenticated user off-site. Mirrors the exact
// call shape used in src/app/[lang]/sign-in/page.tsx: safeNextPath(next, SITE_URL, `/${lang}`).
import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-redirect";

const SITE_URL = "https://lixtara.com";
const fallback = "/en";

describe("sign-in post-auth redirect — next is validated to same-origin", () => {
  it("honors legitimate destinations", () => {
    expect(safeNextPath("/en/dashboard", SITE_URL, fallback)).toBe("/en/dashboard");
    expect(safeNextPath("/es/listing/new?step=3", SITE_URL, fallback)).toBe("/es/listing/new?step=3");
    expect(safeNextPath(undefined, SITE_URL, fallback)).toBe("/en"); // default when no next
  });

  const external: string[] = [
    "https://example.com",
    "//example.com",
    "@example.com",
    "https://lixtara.com@example.com",
    "https://evil.lixtara.com",
    "https://lixtara.com.example.com",
    "/\\example.com",
    "javascript:alert(1)",
  ];
  for (const next of external) {
    it(`never redirects off-origin for ${JSON.stringify(next)}`, () => {
      const out = safeNextPath(next, SITE_URL, fallback);
      expect(new URL(out, SITE_URL).origin).toBe(SITE_URL);
    });
  }
});

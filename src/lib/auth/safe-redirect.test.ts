import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-redirect";

const ORIGIN = "https://lixtara.com";

describe("safeNextPath — same-origin relative destinations pass through", () => {
  it("accepts a plain relative path", () => {
    expect(safeNextPath("/dashboard", ORIGIN)).toBe("/dashboard");
  });
  it("preserves a safe query and hash", () => {
    expect(safeNextPath("/es/dashboard?tab=1#top", ORIGIN)).toBe("/es/dashboard?tab=1#top");
  });
  it("the app's own emailRedirectTo next values are accepted", () => {
    expect(safeNextPath("/en", ORIGIN)).toBe("/en");
    expect(safeNextPath("/es/listing/new?step=1", ORIGIN)).toBe("/es/listing/new?step=1");
  });
});

describe("safeNextPath — off-origin destinations collapse to fallback", () => {
  // These resolve to a DIFFERENT origin and MUST become the safe fallback.
  const offOrigin: Array<[string, string]> = [
    ["https://example.com", "absolute external"],
    ["http://example.com", "absolute external http"],
    ["//example.com", "protocol-relative"],
    ["/\\example.com", "backslash smuggle"],
    ["https://lixtara.com@example.com", "userinfo direct (absolute → host example.com)"],
    ["https://lixtara.com.example.com", "look-alike domain"],
    ["https://lixtara.com.evil.co/phish", "look-alike subdomain path"],
    ["javascript:alert(1)", "javascript scheme"],
    ["\thttps://example.com", "leading control char + external"],
  ];
  for (const [next, desc] of offOrigin) {
    it(`${desc} → fallback "/"`, () => {
      expect(safeNextPath(next, ORIGIN)).toBe("/");
    });
  }

  // These stay on our origin (as harmless literal paths) — they never reach example.com, which
  // is the whole point. The %2F is NOT decoded into a path separator by the browser, so the
  // request just hits a 404 path on lixtara.com, never an external redirect.
  const sameOriginPaths: Array<[string, string]> = [
    ["@example.com", "userinfo breakout (the LIVE vector) — URL-resolves to a harmless /@example.com path"],
    ["%2F%2Fexample.com", "encoded //"],
    ["%252F%252Fexample.com", "double-encoded //"],
  ];
  for (const [next, desc] of sameOriginPaths) {
    it(`${desc} → stays same-origin (never external)`, () => {
      const out = safeNextPath(next, ORIGIN);
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
    });
  }

  it("no input EVER yields an off-origin destination", () => {
    for (const [next] of [...offOrigin, ...sameOriginPaths]) {
      expect(new URL(safeNextPath(next, ORIGIN), ORIGIN).origin).toBe(ORIGIN);
    }
  });
});

describe("safeNextPath — degenerate inputs", () => {
  it("null / undefined / empty → fallback", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/");
    expect(safeNextPath(undefined, ORIGIN)).toBe("/");
    expect(safeNextPath("", ORIGIN)).toBe("/");
  });
  it("honors a custom fallback", () => {
    expect(safeNextPath("https://example.com", ORIGIN, "/en")).toBe("/en");
  });
  it("a userinfo path that resolves onto our origin stays a harmless path, never a redirect off-site", () => {
    // "@example.com" resolves to https://lixtara.com/@example.com under URL resolution — but the
    // string-concat bug made it https://lixtara.com@example.com (host example.com). We must NOT
    // reproduce the concat: confirm the returned value, joined to origin, stays same-origin.
    const out = safeNextPath("@example.com", ORIGIN);
    expect(new URL(out, ORIGIN).host).toBe("lixtara.com");
  });
});

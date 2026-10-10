import { describe, it, expect } from "vitest";
import { localeAlternates } from "@/lib/seo";

const SITE = "https://lixtara.com";

describe("localeAlternates", () => {
  it("builds canonical + hreflang for a localized page", () => {
    expect(localeAlternates("/es/services", SITE)).toEqual({
      canonical: "https://lixtara.com/es/services",
      languages: {
        en: "https://lixtara.com/en/services",
        es: "https://lixtara.com/es/services",
        "x-default": "https://lixtara.com/en/services",
      },
    });
  });

  it("handles the home page and trailing slashes", () => {
    expect(localeAlternates("/en", SITE).canonical).toBe("https://lixtara.com/en");
    expect(localeAlternates("/es/", SITE).languages.en).toBe("https://lixtara.com/en");
  });

  it("drops the query string from the canonical", () => {
    expect(localeAlternates("/en/properties?utm_source=meta", SITE).canonical).toBe(
      "https://lixtara.com/en/properties",
    );
  });
});

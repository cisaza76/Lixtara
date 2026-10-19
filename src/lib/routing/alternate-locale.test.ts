import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { alternateLocaleHref } from "./alternate-locale";

describe("selector de idioma: la misma página en el otro idioma", () => {
  it.each([
    ["/en", "", "es", "/es"],
    ["/en/", "", "es", "/es"],
    ["/es/terms", "", "en", "/en/terms"],
    ["/en/listing/new", "id=abc&step=3", "es", "/es/listing/new?id=abc&step=3"],
    ["/es/property/123", "?x=1", "en", "/en/property/123?x=1"],
    ["/en/admin/listings/9/review", "", "es", "/es/admin/listings/9/review"],
    ["/about", "", "es", "/es/about"],
  ] as const)("%s ?%s → %s: %s", (path, search, target, want) => {
    expect(alternateLocaleHref(path, search, target)).toBe(want);
  });

  it("el encabezado y el menú móvil usan el componente, no un enlace a la portada", () => {
    for (const f of ["src/app/[lang]/layout.tsx", "src/components/mobile-menu.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("<LanguageSwitchLink");
      expect(src, f).not.toContain("href={`/${altLang}`}");
    }
  });
});

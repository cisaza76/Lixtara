import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { locales, t } from "./i18n";

const root = resolve(__dirname, "../..");
// Páginas indexables que antes heredaban el título y la descripción del inicio.
const PAGES = ["services", "properties", "consultations"] as const;

describe("título y descripción propios por página", () => {
  it("cada página tiene título ≤ 60 y descripción ≤ 155, distintos del inicio y entre sí", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const lang of locales) {
      const d = t(lang);
      titles.add(d.meta.siteTitle);
      descriptions.add(d.meta.siteDescription);
      for (const page of PAGES) {
        const title = `${d[page].metaTitle} | Lixtara`;
        const description = d[page].metaDescription;
        expect(title.length, `${lang} ${page} title`).toBeLessThanOrEqual(60);
        expect(description.length, `${lang} ${page} description`).toBeLessThanOrEqual(155);
        expect(titles.has(title), `${lang} ${page} title repetido`).toBe(false);
        expect(descriptions.has(description), `${lang} ${page} description repetida`).toBe(false);
        titles.add(title);
        descriptions.add(description);
      }
    }
  });

  it("cada page.tsx la usa y no pisa el canonical ni el hreflang del layout", () => {
    for (const page of PAGES) {
      const src = readFileSync(join(root, "src", "app", "[lang]", page, "page.tsx"), "utf8");
      expect(src, page).toContain("export async function generateMetadata");
      expect(src, page).toContain(`.${page};`);
      expect(src, page).toContain("copy.metaDescription");
      expect(src, page).not.toContain("alternates");
    }
  });
});

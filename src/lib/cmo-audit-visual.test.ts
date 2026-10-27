import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SECTION_INNER, SECTION_TITLE_GAP } from "@/components/home-sections";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

// Auditoría UX del CMO (2026-10-26), hallazgos #02, #03 y #06.
describe("auditoría CMO: espaciado de la portada (#02, #03)", () => {
  it("las secciones de la portada y de /owners usan el contenedor compartido, sin el aire anterior", () => {
    expect(SECTION_INNER).toContain("py-14 lg:py-20");
    expect(SECTION_TITLE_GAP).toBe("mb-10 lg:mb-12");
    for (const f of ["src/app/[lang]/page.tsx", "src/app/[lang]/owners/page.tsx", "src/components/home-sections.tsx"]) {
      const src = read(f);
      expect(src, f).not.toContain("py-20 lg:py-28");
      expect(src, f).not.toContain("mb-16 lg:mb-20");
    }
  });

  it("hero → 'Why Lixtara': el hero termina con poco padding y la sección siguiente empieza con poco", () => {
    const src = read("src/app/[lang]/page.tsx");
    expect(src).toContain("pb-10 lg:pb-12 flex-1");
    expect(src).toContain("${SECTION_X} pt-10 lg:pt-12 pb-14 lg:pb-20");
  });
});

describe("auditoría CMO: acciones sobre las fotos del paso 5 (#06)", () => {
  const src = read("src/components/photo-grid-draggable.tsx");

  it("las acciones no dependen del hover ni van sobre la foto", () => {
    expect(src).not.toContain("group-hover:opacity-100");
    expect(src).not.toContain("bg-gradient-to-t");
  });

  it("los botones de acción usan texto de 12 px, sin mayúsculas forzadas", () => {
    const bar = src.slice(src.indexOf("Acciones siempre visibles"));
    expect(bar).toContain("labels.stageButton");
    expect(bar).toContain("labels.livingButton");
    expect(bar).toContain("labels.deleteButton");
    expect(bar).not.toMatch(/text-\[(8|9|10|11)px\]/);
    expect(bar).not.toContain("uppercase");
    expect(bar.match(/text-xs/g)?.length).toBeGreaterThanOrEqual(3);
    // Eliminar va aparte y en rojo (acción destructiva).
    expect(bar).toMatch(/border-t border-gold-soft[\s\S]*text-red-700[\s\S]*labels\.deleteButton/);
  });
});

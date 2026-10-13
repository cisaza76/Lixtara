import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SPANISH_ANCHOR_ALIASES,
  SPANISH_SLUG_ALIASES,
  resolveSlugAlias,
} from "./slug-aliases";

const LANG_DIR = resolve(__dirname, "../../app/[lang]");

describe("resolveSlugAlias (#114)", () => {
  it("slug español sin idioma → /es/<ruta canónica>", () => {
    expect(resolveSlugAlias("/servicios")).toEqual({ pathname: "/es/services" });
    expect(resolveSlugAlias("/propiedades")).toEqual({ pathname: "/es/properties" });
    expect(resolveSlugAlias("/vender")).toEqual({ pathname: "/es/listing/new" });
    expect(resolveSlugAlias("/contacto/")).toEqual({ pathname: "/es/contact" });
  });

  it("respeta el idioma explícito", () => {
    expect(resolveSlugAlias("/es/servicios")).toEqual({ pathname: "/es/services" });
    expect(resolveSlugAlias("/en/servicios")).toEqual({ pathname: "/en/services" });
  });

  it("conserva el resto del path", () => {
    expect(resolveSlugAlias("/propiedad/abc")).toEqual({ pathname: "/es/property/abc" });
  });

  it("no distingue mayúsculas ni se rompe con codificación inválida", () => {
    expect(resolveSlugAlias("/Servicios")).toEqual({ pathname: "/es/services" });
    expect(resolveSlugAlias("/%E0%A4%A")).toBeNull();
  });

  it("anclas de la landing", () => {
    expect(resolveSlugAlias("/precios")).toEqual({ pathname: "/es", hash: "pricing" });
    expect(resolveSlugAlias("/en/precios")).toEqual({ pathname: "/en", hash: "pricing" });
    expect(resolveSlugAlias("/precios/otra")).toBeNull();
  });

  it("no toca rutas canónicas ni desconocidas (sin bucles)", () => {
    for (const p of ["/", "/en", "/es/services", "/en/properties", "/services", "/xyz"]) {
      expect(resolveSlugAlias(p), p).toBeNull();
    }
  });

  it("cada destino es una ruta que existe en src/app/[lang]", () => {
    for (const route of new Set(Object.values(SPANISH_SLUG_ALIASES))) {
      expect(existsSync(join(LANG_DIR, route)), route).toBe(true);
    }
  });

  it("cada ancla existe en la landing", async () => {
    const { readFileSync } = await import("node:fs");
    const landing = readFileSync(join(LANG_DIR, "page.tsx"), "utf8");
    for (const id of new Set(Object.values(SPANISH_ANCHOR_ALIASES))) {
      expect(landing, id).toContain(`id="${id}"`);
    }
  });

  it("ningún alias choca con una ruta real", () => {
    for (const slug of [...Object.keys(SPANISH_SLUG_ALIASES), ...Object.keys(SPANISH_ANCHOR_ALIASES)]) {
      expect(existsSync(join(LANG_DIR, slug)), slug).toBe(false);
    }
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// #123: el footer enlazaba /[lang]/closing-costs, una ruta que no existe (404 en cada
// página + error de prefetch en consola). Todo enlace interno del layout debe apuntar a
// una ruta real de src/app/[lang].
const LANG_DIR = resolve(__dirname, "../../app/[lang]");
const layout = readFileSync(join(LANG_DIR, "layout.tsx"), "utf8");

describe("enlaces internos del layout", () => {
  const routes = [...layout.matchAll(/href=\{`\/\$\{lang\}\/([a-z0-9\-/]+)[`?#]/g)].map((m) =>
    m[1].replace(/\/$/, ""),
  );

  it("encuentra enlaces (el extractor no pasa en vacío)", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it("cada uno existe en src/app/[lang]", () => {
    const missing = routes.filter((r) => !existsSync(join(LANG_DIR, r)));
    expect(missing).toEqual([]);
  });

  it("closing-costs ya no está enlazado", () => {
    expect(layout).not.toContain("closing-costs");
  });
});

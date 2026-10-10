import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Fotos del feed IDX: SOLO hot-link (§ III.B.9 prohíbe descargar contenido licenciado; § VI.C
// obliga a purgarlo todo, caché incluida, al terminar el acuerdo). next/image pasaría cada
// foto por el optimizador de Vercel, que la descarga y guarda copias. Este test impide
// reintroducirlo en la tarjeta, y que el host del MLS se añada a `images.remotePatterns`.

const SRC = resolve(__dirname, "../..");

describe("fotos del MLS por hot-link", () => {
  it("la tarjeta del feed no usa next/image", () => {
    const card = readFileSync(resolve(SRC, "components/mls-listing-card.tsx"), "utf8");
    expect(card).not.toMatch(/from\s+["']next\/image["']/);
    expect(card).toMatch(/<img\b/);
  });

  it("next.config no autoriza más hosts de imagen que los propios", () => {
    const config = readFileSync(resolve(SRC, "../next.config.ts"), "utf8");
    const hosts = [...config.matchAll(/hostname:\s*["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(hosts).toEqual(["fizhoufepowilbhbtfkg.supabase.co", "images.unsplash.com"]);
  });
});

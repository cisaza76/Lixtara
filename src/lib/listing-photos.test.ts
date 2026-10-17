import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MIN_OWN_PHOTOS, ownPhotosRequired } from "@/lib/listing-photos";
import { t } from "@/lib/i18n";

describe("paso 5: una sola regla de fotos", () => {
  it("Essentials (o sin plan) exige fotos propias; Pro y Concierge no", () => {
    expect(ownPhotosRequired("essentials")).toBe(true);
    expect(ownPhotosRequired(null)).toBe(true);
    expect(ownPhotosRequired("pro")).toBe(false);
    expect(ownPhotosRequired("concierge")).toBe(false);
  });

  it("ningún texto del paso 5 promete otro mínimo (antes: 10, 5 y opcional a la vez)", () => {
    for (const lang of ["en", "es"] as const) {
      const step5 = JSON.stringify(t(lang).listingForm.step5);
      // Números escritos a mano: el mínimo va siempre como {min}.
      expect(step5, lang).not.toMatch(/(at least|al menos) \d+ (high|phone|photos|fotos)/i);
      expect(step5, lang).toContain("{min}");
    }
  });

  it("el servidor usa la misma regla", () => {
    const page = readFileSync(join(resolve(__dirname, "../.."), "src/app/[lang]/listing/new/page.tsx"), "utf8");
    expect(page).toContain("photoCount < MIN_OWN_PHOTOS");
    expect(page).toContain("ownPhotosRequired(");
    expect(MIN_OWN_PHOTOS).toBe(10);
  });
});

describe("Essentials con el extra de fotografía pagado (2026-10-16)", () => {
  it("las fotos propias pasan a ser opcionales, igual que en Pro", () => {
    expect(ownPhotosRequired("essentials")).toBe(true);
    expect(ownPhotosRequired("essentials", false)).toBe(true);
    expect(ownPhotosRequired("essentials", true)).toBe(false);
    expect(ownPhotosRequired("pro", false)).toBe(false);
    expect(ownPhotosRequired(null, true)).toBe(false);
  });

  it("el servidor, el paso 5 y el paso 6 aplican la misma regla con el pago", () => {
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page).toMatch(/ownPhotosRequired\(\s*prop\?\.pricing_tier as string \| null,\s*await hasPaidPhotography\(supabase, id\),\s*\)/);
    expect(page).toContain("const photosRequired = ownPhotosRequired(draft?.pricing_tier ?? null, photographyPaid);");
    expect(page).toContain("(ownPhotosRequired(draft.pricing_tier, photographyPaid) && photos.length < MIN_OWN_PHOTOS)");
    expect(page).not.toContain("photos.length < 10");
    const lookup = readFileSync("src/lib/listing-photos.server.ts", "utf8");
    expect(lookup).toContain('.is("tier", null)');
    expect(lookup).toContain('.eq("status", "succeeded")');
  });
});

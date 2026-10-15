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

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MIN_FRONT_PHOTOS, MIN_OWN_PHOTOS, minPhotos, ownPhotosRequired } from "@/lib/listing-photos";
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
    expect(page).toContain("if (photoCount < requiredPhotos) {");
    expect(page).toContain("minPhotos(");
    expect(MIN_OWN_PHOTOS).toBe(10);
  });

  it("al menos la foto del frente en todos los planes (SEFMLS §15.1.1 y §15.1.12)", () => {
    expect(MIN_FRONT_PHOTOS).toBe(1);
    expect(minPhotos("essentials")).toBe(MIN_OWN_PHOTOS);
    expect(minPhotos(null)).toBe(MIN_OWN_PHOTOS);
    expect(minPhotos("essentials", true)).toBe(1);
    expect(minPhotos("pro")).toBe(1);
    expect(minPhotos("concierge")).toBe(1);
    expect(minPhotos("pro", true)).toBe(1);
  });

  it("el servidor exige derechos y mínimo en todos los planes; ya no hay paso 5 sin fotos", () => {
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page).toContain('if (formData.get("photos_rights_confirmed") !== "1") {');
    expect(page).not.toContain("needsOwnPhotos");
    expect(page).toMatch(/name="photos_rights_confirmed"\s+value="1"\s+required\s/);
    expect(page).toContain("photos.length < requiredPhotos;");
  });

  it("texto del paso 5: foto del frente con fotografía profesional; sin marcas para todos", () => {
    const en = t("en").listingForm.step5;
    const es = t("es").listingForm.step5;
    for (const body of [es.bodyPro, es.bodyPhotographyPaid]) {
      expect(body).toContain("Sube al menos una foto del frente de la casa. Tu fotógrafo profesional tomará el resto.");
    }
    for (const body of [en.bodyPro, en.bodyPhotographyPaid]) {
      expect(body).toContain("Upload at least one photo of the front of the house. Your professional photographer will take the rest.");
    }
    expect(es.noMarksNote).toBe("Sin marcas de agua, logos ni texto en las fotos.");
    expect(en.noMarksNote).toBe("No watermarks, logos or text on the photos.");
    expect(readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8")).toContain("{copy.step5.noMarksNote}");
    for (const lang of ["en", "es"] as const) {
      const { step5, step6 } = t(lang).listingForm;
      expect(JSON.stringify({ step5, step6 }), lang).not.toMatch(/optional|opcional/i);
    }
  });
});

describe("Essentials con el extra de fotografía pagado (2026-10-16)", () => {
  it("deja de exigir el set propio, igual que Pro (sigue la foto del frente)", () => {
    expect(ownPhotosRequired("essentials")).toBe(true);
    expect(ownPhotosRequired("essentials", false)).toBe(true);
    expect(ownPhotosRequired("essentials", true)).toBe(false);
    expect(ownPhotosRequired("pro", false)).toBe(false);
    expect(ownPhotosRequired(null, true)).toBe(false);
  });

  it("el servidor, el paso 5 y el paso 6 aplican la misma regla con el pago", () => {
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page).toMatch(/minPhotos\(\s*prop\?\.pricing_tier as string \| null,\s*await hasPaidPhotography\(supabase, id\),\s*\)/);
    expect(page).toContain("const requiredPhotos = minPhotos(draft?.pricing_tier ?? null, photographyPaid);");
    expect(page).not.toContain("photos.length < 10");
    const lookup = readFileSync("src/lib/listing-photos.server.ts", "utf8");
    expect(lookup).toContain('.is("tier", null)');
    expect(lookup).toContain('.eq("status", "succeeded")');
  });
});

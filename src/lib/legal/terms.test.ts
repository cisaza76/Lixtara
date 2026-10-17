import { describe, it, expect } from "vitest";
import { termsDoc } from "@/lib/legal/terms";
import { fillLegalDoc } from "@/lib/legal/config";
import { PRICING_TIERS } from "@/lib/pricing-tiers";

const raw = (lang: "en" | "es") => JSON.stringify(termsDoc[lang]);

describe("Términos de servicio (borrador 2026-10)", () => {
  it("anclas que usa el sitio, en EN y ES: #fees, #refunds (paso 8), #term", () => {
    for (const lang of ["en", "es"] as const) {
      const ids = termsDoc[lang].sections.map((s) => s.id).filter(Boolean);
      expect(ids, lang).toEqual(["fees", "refunds", "term"]);
    }
  });

  it("ningún precio, porcentaje, licencia ni dirección escrito a mano", () => {
    for (const lang of ["en", "es"] as const) {
      const s = raw(lang);
      expect(s, lang).not.toMatch(/\$\d/);
      expect(s, lang).not.toMatch(/\b\d+(\.\d+)?%/);
      expect(s, lang).not.toMatch(/\b(CQ|BK|SL)\d{5,}/);
      expect(s, lang).not.toMatch(/Vera C/);
    }
  });

  it("con los marcadores llenos, muestra los precios y porcentajes de pricing-tiers", () => {
    for (const lang of ["en", "es"] as const) {
      const s = JSON.stringify(fillLegalDoc(termsDoc[lang]));
      for (const t of Object.values(PRICING_TIERS)) {
        expect(s, `${lang} ${t.id}`).toContain(`$${t.flatFee}`);
        expect(s, `${lang} ${t.id}`).toContain(`${t.commissionPct}%`);
      }
      expect(s, lang).not.toMatch(/\{[a-zA-Z]+\}/); // ningún marcador sin llenar
    }
  });

  it("la política de reembolso del owner, exacta, en los dos idiomas", () => {
    const refunds = (lang: "en" | "es") => JSON.stringify(termsDoc[lang].sections.find((s) => s.id === "refunds"));
    expect(refunds("en")).toContain("not refundable once your listing has been published on the MLS");
    expect(refunds("es")).toContain("no es reembolsable una vez que su listado se publica en el MLS");
    for (const lang of ["en", "es"] as const) {
      expect(termsDoc[lang].sections.find((s) => s.id === "refunds")!.bullets, lang).toHaveLength(3);
    }
  });

  it("prevalece la versión en inglés", () => {
    expect(raw("en")).toContain("the English version governs");
    expect(raw("es")).toContain("prevalece la versión en inglés");
  });
});

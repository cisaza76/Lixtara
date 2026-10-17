import { describe, it, expect } from "vitest";
import { noticesDoc } from "@/lib/legal/notices";
import { disclaimersDoc } from "@/lib/legal/disclaimers";
import { accessibilityDoc } from "@/lib/legal/accessibility";
import { fillLegalDoc } from "@/lib/legal/config";
import type { LegalContent, LegalSection } from "@/lib/legal/types";

const DOCS: Record<string, LegalContent> = {
  notices: noticesDoc,
  disclaimers: disclaimersDoc,
  accessibility: accessibilityDoc,
};

function ids(sections: LegalSection[]): string[] {
  return sections.flatMap((s) => [...(s.id ? [s.id] : []), ...ids(s.sub ?? [])]);
}

describe("avisos, disclaimers y accesibilidad (borrador 2026-10)", () => {
  it.each(Object.entries(DOCS))("%s: EN y ES tienen contenido y las mismas secciones", (_, doc) => {
    for (const lang of ["en", "es"] as const) {
      expect(doc[lang].title, lang).toBeTruthy();
      expect(doc[lang].sections.length, lang).toBeGreaterThan(0);
    }
    expect(ids(doc.es.sections)).toEqual(ids(doc.en.sections));
    expect(doc.es.sections.length).toBe(doc.en.sections.length);
  });

  it("los avisos tienen todas las secciones pedidas", () => {
    for (const id of ["brokerage", "relationship", "commissions", "buyer-compensation", "fair-housing", "wire-fraud", "respa"]) {
      expect(ids(noticesDoc.en.sections), id).toContain(id);
    }
    for (const id of ["idx", "valuations", "public-records", "ai"]) {
      expect(ids(disclaimersDoc.en.sections), id).toContain(id);
    }
  });

  it("\"las comisiones son negociables y no las fija la ley\", en EN y ES", () => {
    expect(JSON.stringify(noticesDoc.en)).toContain("Commissions are negotiable and are not set by law.");
    expect(JSON.stringify(noticesDoc.es)).toContain("Las comisiones son negociables y no las fija la ley.");
  });

  it.each(Object.entries(DOCS))("%s: ningún número de licencia, nombre de la broker ni dirección escrito a mano", (_, doc) => {
    const raw = JSON.stringify(doc);
    expect(raw).not.toMatch(/\b(CQ|BK|SL)\d{5,}/);
    expect(raw).not.toMatch(/Velasquez|Vera Ct|Vera Court/);
    // Con los marcadores reemplazados sí aparecen (y no queda ninguno sin reemplazar).
    for (const lang of ["en", "es"] as const) {
      const filled = JSON.stringify(fillLegalDoc(doc[lang]));
      expect(filled, lang).not.toMatch(/\{[a-zA-Z]+\}/);
    }
    expect(JSON.stringify(fillLegalDoc(noticesDoc.en))).toMatch(/FL #CQ\d+/);
  });

  it("la declaración de accesibilidad no afirma cumplimiento total", () => {
    for (const lang of ["en", "es"] as const) {
      const raw = JSON.stringify(accessibilityDoc[lang]);
      expect(raw, lang).toMatch(/WCAG\) 2\.1/);
      expect(raw, lang).not.toMatch(/fully (comply|conform)|cumple(mos)? (totalmente|plenamente)|in compliance with/i);
    }
  });
});

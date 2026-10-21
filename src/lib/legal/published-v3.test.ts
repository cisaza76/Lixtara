// Términos v3 publicados (2026-10-21, decisión de la broker, pendiente de revisión del abogado;
// docs/legal/2026-10-21-textos-v3-memo.md). Falla si se pierde uno de sus cambios:
//   - §6: si el vendedor cancela después de publicar en el MLS, paga una tarifa de cancelación
//     igual a la tarifa fija de su plan; antes de publicar, el reembolso sigue siendo total;
//   - la casilla del paso 8 menciona esa tarifa;
//   - solo los Términos cambian de versión: los demás documentos siguen en la v2.
import { describe, it, expect } from "vitest";
import { LEGAL_DOCS } from "./config";
import { consentCheckbox } from "./consents";
import { termsDoc } from "./terms";
import { PROTECTION_PERIOD_DAYS } from "@/config/listing-agreement";
import { PRICING_TIERS, TIER_ORDER, formatPrice } from "@/lib/pricing-tiers";

const section6 = (lang: "en" | "es") => termsDoc[lang].sections.find((s) => s.heading.startsWith("6."))!.body.join("\n");

describe("Términos v3 (2026-10-21)", () => {
  it("versión 2026-10-21-v3 solo en los Términos", () => {
    expect(LEGAL_DOCS.terms.version).toBe("2026-10-21-v3");
    expect(LEGAL_DOCS.terms.updated).toBe("2026-10-21");
    for (const id of ["privacy", "cookies", "disclaimers", "notices", "accessibility"] as const) expect(LEGAL_DOCS[id].version, id).toBe("2026-10-18-v2");
  });

  it("§6: tarifa de cancelación igual a la tarifa fija después de publicar; reembolso total antes", () => {
    expect(section6("en")).toContain("If you cancel after it's published on the MLS, you pay a cancellation fee equal to your plan's flat fee");
    expect(section6("en")).toContain("or if you cancel before it's published");
    expect(section6("es")).toContain(
      "Si usted cancela después de que su propiedad esté publicada en el MLS, pagará una tarifa de cancelación igual a la tarifa fija de su plan",
    );
    expect(section6("es")).toContain("o si usted cancela antes de la publicación");
    for (const lang of ["en", "es"] as const)
      for (const t of TIER_ORDER) expect(section6(lang), `${lang} ${t}`).toContain(formatPrice(PRICING_TIERS[t].flatFee));
  });

  it("casilla del paso 8: la tarifa de cancelación del plan después de publicar", () => {
    for (const t of TIER_ORDER) {
      const fee = formatPrice(PRICING_TIERS[t].flatFee);
      expect(consentCheckbox("terms_refund", "en", t).before).toContain(`If I cancel after publication, I pay a ${fee} cancellation fee`);
      expect(consentCheckbox("terms_refund", "es", t).before).toContain(`Si cancelo después de la publicación, pago una tarifa de cancelación de ${fee}`);
    }
  });

  it("período de protección: una sola constante de 90 días", () => {
    expect(PROTECTION_PERIOD_DAYS).toBe(90);
  });
});

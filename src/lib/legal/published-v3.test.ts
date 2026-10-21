// Términos v3 publicados (2026-10-21, decisión de la broker, pendiente de revisión del abogado;
// docs/legal/2026-10-21-textos-v3-memo.md). Falla si se pierde uno de sus cambios:
//   - §6: si el vendedor cancela después de publicar en el MLS, la tarifa de cancelación es igual
//     a la tarifa fija ya pagada y se considera pagada con ella (nada adicional); antes de
//     publicar, el reembolso sigue siendo total;
//   - la casilla del paso 8 dice lo mismo;
//   - §16 remite al párrafo 12 (Conditional Termination) del acuerdo de listado, no a un anexo;
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

  it("§6: después de publicar, la tarifa de cancelación es la tarifa fija ya pagada, sin monto adicional; reembolso total antes", () => {
    expect(section6("en")).toContain(
      "If you cancel after it's published on the MLS, the cancellation fee in your listing agreement equals the flat fee you already paid for your plan",
    );
    expect(section6("en")).toContain("and is deemed paid by it: you pay nothing additional.");
    expect(section6("en")).toContain("or if you cancel before it's published");
    expect(section6("es")).toContain(
      "Si usted cancela después de que su propiedad esté publicada en el MLS, la tarifa de cancelación de su acuerdo de listado es igual a la tarifa fija que usted ya pagó por su plan",
    );
    expect(section6("es")).toContain("y se considera pagada con ella: no se le cobra ningún monto adicional.");
    expect(section6("es")).toContain("o si usted cancela antes de la publicación");
    for (const lang of ["en", "es"] as const)
      for (const t of TIER_ORDER) expect(section6(lang), `${lang} ${t}`).toContain(formatPrice(PRICING_TIERS[t].flatFee));
  });

  it("casilla del paso 8: después de publicar, la tarifa de cancelación es la tarifa fija ya pagada", () => {
    for (const t of TIER_ORDER) {
      const fee = formatPrice(PRICING_TIERS[t].flatFee);
      expect(consentCheckbox("terms_refund", "en", t).before).toContain(`equals the ${fee} flat fee I already paid and is deemed paid by it; I pay nothing additional.`);
      expect(consentCheckbox("terms_refund", "es", t).before).toContain(`es igual a la tarifa fija de ${fee} que ya pagué y se considera pagada con ella; no pago nada adicional.`);
    }
  });

  it("§16: remite al párrafo 12 (Conditional Termination) del acuerdo de listado, sin anexo", () => {
    const s16 = (lang: "en" | "es") => termsDoc[lang].sections.find((s) => s.heading.startsWith("16."))!.body.join(" ");
    expect(s16("en")).toContain("subject to your signed listing agreement, including its Paragraph 12 (Conditional Termination).");
    expect(s16("es")).toContain("sujeto a lo que establezca su acuerdo de listado firmado, incluido su párrafo 12 (Conditional Termination, terminación condicional).");
    for (const lang of ["en", "es"] as const) expect(JSON.stringify(termsDoc[lang])).not.toMatch(/Addendum|Anexo de Terminación/);
  });

  it("período de protección: una sola constante de 90 días", () => {
    expect(PROTECTION_PERIOD_DAYS).toBe(90);
  });
});

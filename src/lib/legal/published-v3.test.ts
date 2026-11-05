// Términos v3 (2026-10-21, modelo final del owner, pendiente de revisión del abogado;
// docs/legal/2026-10-21-textos-v3-memo.md). Falla si se pierde uno de sus cambios:
//   - §6: la tarifa fija no se reembolsa una vez publicada; reembolso total si no se aprueba o no
//     se publica; el vendedor termina cuando quiera, sin costo; comisión solo si la venta se
//     cierra, al cierre. Ninguna tarifa de cancelación;
//   - la casilla del paso 8 dice lo mismo;
//   - §16 remite al párrafo 15 (Additional Terms) del acuerdo de listado y explica el período de
//     protección con PROTECTION_PERIOD_DAYS y PROTECTION_NOTICE_DAYS;
//   - solo los Términos cambian de versión: los demás documentos siguen en la v2.
import { describe, it, expect } from "vitest";
import { dictionaries } from "@/lib/i18n";
import { LEGAL_DOCS } from "./config";
import { consentCheckbox } from "./consents";
import { termsDoc } from "./terms";
import { listingTermination, refundPolicy } from "@/config/legal-terms";
import { PROTECTION_NOTICE_DAYS, PROTECTION_PERIOD_DAYS } from "@/config/listing-agreement";
import { REQUESTS_COPY } from "@/lib/listing-requests-copy";
import { TIER_ORDER } from "@/lib/pricing-tiers";

const LANGS = ["en", "es"] as const;
const section = (lang: "en" | "es", n: number) => termsDoc[lang].sections.find((s) => s.heading.startsWith(`${n}.`))!.body.join("\n");
const CANCELLATION_FEE = /cancellation fee|tarifa de cancelaci[oó]n/i;

describe("Términos v3 (2026-10-21)", () => {
  it("versión 2026-10-21-v3 solo en los Términos", () => {
    expect(LEGAL_DOCS.terms.version).toBe("2026-10-21-v3");
    expect(LEGAL_DOCS.terms.updated).toBe("2026-10-21");
    for (const id of ["disclaimers", "notices", "accessibility"] as const) expect(LEGAL_DOCS[id].version, id).toBe("2026-10-18-v2");
    // Privacidad y Cookies pasaron a la v4 (2026-10-24, categoría Publicidad).
    for (const id of ["privacy", "cookies"] as const) expect(LEGAL_DOCS[id].version, id).toBe("2026-10-24-v4");
  });

  it("§6: no reembolsable una vez publicada, reembolso total antes, terminación sin costo, comisión al cierre", () => {
    expect(section("en", 6)).toContain("The flat fee is non-refundable once your property is published on the MLS.");
    expect(section("en", 6)).toContain("You get a full refund if the broker doesn't approve your listing or it can't be published");
    expect(section("en", 6)).toContain("You can end your listing agreement at any time, at no charge. The Lixtara commission is due only if a sale closes, and it's paid at closing.");
    expect(section("es", 6)).toContain("La tarifa fija no se reembolsa una vez que su propiedad está publicada en el MLS.");
    expect(section("es", 6)).toContain("Le devolvemos el total si la broker no aprueba su listado o no se puede publicar");
    expect(section("es", 6)).toContain("Usted puede terminar su acuerdo de listado en cualquier momento, sin costo. La comisión de Lixtara solo se adeuda si la venta se cierra, y se paga al cierre.");
  });

  it("casilla del paso 8: terminación sin costo y comisión al cierre", () => {
    for (const t of TIER_ORDER) {
      expect(consentCheckbox("terms_refund", "en", t).before).toContain("I can end my listing agreement at any time, at no charge.");
      expect(consentCheckbox("terms_refund", "en", t).before).toMatch(/commission is due only if a sale closes, and it's paid at closing\.$/);
      expect(consentCheckbox("terms_refund", "es", t).before).toContain("Puedo terminar mi acuerdo de listado en cualquier momento, sin costo.");
      expect(consentCheckbox("terms_refund", "es", t).before).toMatch(/solo se paga si la venta se cierra, al momento del cierre\.$/);
    }
  });

  it("§16: párrafo 15 del acuerdo de listado y período de protección desde las constantes", () => {
    expect(section("en", 16)).toContain("subject to your signed listing agreement, including its Paragraph 15 (Additional Terms).");
    expect(section("es", 16)).toContain("sujeto a lo que establezca su acuerdo de listado firmado, incluido su párrafo 15 (Additional Terms, términos adicionales).");
    expect(section("en", 16)).toContain(`within ${PROTECTION_PERIOD_DAYS} days, you sell or agree to sell the property to a buyer who toured it or made a written offer`);
    expect(section("en", 16)).toContain(`in writing within ${PROTECTION_NOTICE_DAYS} days after the agreement ended`);
    expect(section("es", 16)).toContain(`dentro de los ${PROTECTION_PERIOD_DAYS} días siguientes`);
    expect(section("es", 16)).toContain(`por escrito dentro de los ${PROTECTION_NOTICE_DAYS} días siguientes a la terminación`);
    for (const lang of LANGS) expect(JSON.stringify(termsDoc[lang])).not.toMatch(/Addendum|Anexo de Terminación|Paragraph 12|párrafo 12/);
    expect([PROTECTION_PERIOD_DAYS, PROTECTION_NOTICE_DAYS]).toEqual([90, 10]);
  });

  it("ningún texto del sitio, de los Términos ni de la casilla habla de una tarifa de cancelación", () => {
    for (const lang of LANGS) {
      expect(JSON.stringify(termsDoc[lang]), lang).not.toMatch(CANCELLATION_FEE);
      expect(JSON.stringify(dictionaries[lang]), lang).not.toMatch(CANCELLATION_FEE);
      expect(refundPolicy.text[lang], lang).not.toMatch(CANCELLATION_FEE);
      for (const t of TIER_ORDER) expect(consentCheckbox("terms_refund", lang, t).before, `${lang} ${t}`).not.toMatch(CANCELLATION_FEE);
    }
  });

  it("la FAQ y la solicitud de retiro dicen lo mismo que el acuerdo (terminación sin costo, período de protección)", () => {
    for (const lang of LANGS) {
      const faq = dictionaries[lang].faq.items.find((i) => /doesn't sell|no se vende/.test(i.q));
      expect(faq?.a, lang).toContain(listingTermination.text[lang]);
      expect(REQUESTS_COPY[lang].withdrawHelp, lang).toContain(listingTermination.text[lang]);
      expect(REQUESTS_COPY[lang].withdrawHelp, lang).not.toMatch(/24-month agreement still applies|contrato de 24 meses sigue vigente/);
    }
  });
});

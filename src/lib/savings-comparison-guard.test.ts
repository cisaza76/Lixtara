import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fillPricingCopy } from "@/lib/pricing-tiers";
import { t } from "@/lib/i18n";

// Toda comparación con un agente tradicional pasa por compareWithTraditional (misma
// compensación al agente del comprador en ambos lados). Este test falla si una superficie
// vuelve a calcular su propio "tradicional" o a usar un 6 % escrito a mano.
const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const SURFACES = {
  calculator: "src/components/savings-slider.tsx",
  step6: "src/app/[lang]/listing/new/page.tsx",
};

describe("comparaciones de ahorro: una sola fuente y el mismo % al comprador", () => {
  it.each(Object.entries(SURFACES))("%s usa compareWithTraditional", (_, path) => {
    expect(read(path)).toContain("compareWithTraditional(");
  });

  it.each(Object.entries(SURFACES))("%s no calcula su propio tradicional", (_, path) => {
    const src = read(path);
    expect(src).not.toMatch(/\* ?0\.06\b|\/ ?100 ?\* ?6\b|price \* 0\.0[5-6]/);
    expect(src).not.toMatch(/TRADITIONAL_COSTS\.(buyerCommissionPct|typicalBuyerCommissionPct|photography|docContracts)/);
  });

  it("la FAQ (y Loui) muestran la misma cifra que la función, en EN y ES", () => {
    for (const lang of ["en", "es"] as const) {
      const faq = t(lang).faq.items.map((i) => fillPricingCopy(i.a)).join(" ");
      expect(faq, lang).toContain("$27,500");
      expect(faq, lang).toContain("$17,995");
      expect(faq, lang).toContain("$9,505");
      expect(faq, lang).not.toContain("$5,495");
    }
  });

  it("ningún texto promete el 6 % completo ni 'decenas de miles'", () => {
    for (const lang of ["en", "es"] as const) {
      const all = JSON.stringify(t(lang));
      expect(all, lang).not.toMatch(/Tens of thousands in equity|Decenas de miles en patrimonio/);
      expect(all, lang).not.toMatch(/What used to go to a 6% commission|Lo que iba a una comisión del 6%/);
    }
  });

  it("inicio (opción B): rangos de los planes y el 3 % del lado vendedor, calculados", async () => {
    const { fillCommissionCopy } = await import("@/lib/pricing-tiers");
    expect(fillCommissionCopy(t("en").valueProps.props[0].body)).toBe(
      "Instead of the usual 3% to the listing agent, you pay a flat fee plus 0.5 to 1.5% at closing, only if your home sells. You keep the difference.",
    );
    expect(fillCommissionCopy(t("es").valueProps.props[0].body)).toBe(
      "En lugar del 3% habitual para el agente del vendedor, pagas una tarifa fija más entre 0.5 y 1.5% al cierre, solo si tu casa se vende. La diferencia es tuya.",
    );
  });

  it("decimales con punto también en español (2.5, no 2,5)", () => {
    for (const k of ["howToReadBody", "tipBuyerCommission"] as const) {
      expect(t("es").savings[k]).toContain("2.5");
      expect(t("es").savings[k]).not.toContain("2,5");
    }
  });

  it("la ayuda de la calculadora dice lo que el cálculo hace (mismo % en las dos columnas)", () => {
    expect(t("en").savings.tipBuyerCommission).toMatch(/same % in both columns/);
    expect(t("es").savings.tipBuyerCommission).toMatch(/mismo % en las dos columnas/);
    for (const lang of ["en", "es"] as const) {
      expect(t(lang).savings.howToReadBody, lang).not.toMatch(/\$300|\$40/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dictionaries } from "@/lib/i18n";

// El "Buyer rebate program" (0,5 % + devolución) se retiró el 2026-10-11: no es la propuesta
// vigente. Ningún texto público ni respuesta de Loui puede prometer rebate, devolución de
// comisión, cash back ni ahorro para compradores. Cualquier rebate o crédito es una decisión
// comercial separada, sin tomar (docs/planning/2026-10-compradores).
const PROMESA = /rebate|reembolso|cash back|devoluci[oó]n de (la )?comisi[oó]n/i;

describe("sin promesas de rebate al comprador", () => {
  it("los diccionarios públicos (EN y ES) no las contienen", () => {
    for (const lang of ["en", "es"] as const) {
      const texto = JSON.stringify(dictionaries[lang]);
      expect(texto.match(PROMESA)?.[0] ?? null, lang).toBeNull();
    }
  });

  it("la nueva sección de compradores no muestra porcentajes", () => {
    for (const lang of ["en", "es"] as const) {
      expect(JSON.stringify(dictionaries[lang].buyerServices), lang).not.toMatch(/\d\s*%/);
    }
  });

  it("Loui tiene la instrucción explícita de no ofrecer rebate ni porcentajes al comprador", () => {
    const prompt = readFileSync(resolve(__dirname, "loui-prompt.ts"), "utf8");
    expect(prompt).toContain("Lixtara does not currently offer a buyer rebate program");
    expect(prompt).toContain("Do NOT quote buyer percentages, fees, rebates");
    expect(prompt).not.toMatch(/LIXTARA_BUYER_FEE_PCT|REBATE_CAP/);
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BUYER_COMP_MAX_PCT,
  buyerCommissionAck,
  cassb1Tabs,
  compensationAgreementsFor,
  formatOffer,
  offerChoice,
  offerFromRow,
  offerToRow,
  parseOfferInput,
  suggestedOffer,
} from "@/lib/buyer-comp";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("oferta al agente del comprador: entrada del paso 6", () => {
  it("0% es una elección válida (nunca se bloquea)", () => {
    expect(parseOfferInput({ choice: "0" }, 500_000)).toEqual({ ok: true, offer: { type: "none" } });
  });

  it("2, 2.5 y 3% son porcentajes", () => {
    for (const p of ["2", "2.5", "3"]) {
      expect(parseOfferInput({ choice: p }, 500_000)).toEqual({ ok: true, offer: { type: "percent", pct: Number(p) } });
    }
  });

  it("sin elección se pide elegir (Essentials y Pro no traen preselección)", () => {
    expect(parseOfferInput({ choice: "" }, 500_000)).toEqual({ ok: false, error: "choice_required" });
    expect(parseOfferInput({ choice: null }, 500_000)).toEqual({ ok: false, error: "choice_required" });
    expect(parseOfferInput({ choice: "7" }, 500_000)).toEqual({ ok: false, error: "choice_required" });
  });

  it("porcentaje personalizado: mayor que 0 y hasta 6", () => {
    const pct = (v: string) => parseOfferInput({ choice: "custom", customKind: "percent", customValue: v }, 500_000);
    expect(pct("2.75")).toEqual({ ok: true, offer: { type: "percent", pct: 2.75 } });
    expect(pct("6")).toEqual({ ok: true, offer: { type: "percent", pct: 6 } });
    expect(pct("1.5%")).toEqual({ ok: true, offer: { type: "percent", pct: 1.5 } });
    for (const bad of ["0", "6.01", "-1", "abc", "", "2,5"]) expect(pct(bad), bad).toEqual({ ok: false, error: "pct_range" });
    expect(BUYER_COMP_MAX_PCT).toBe(6);
  });

  it("monto fijo: mayor que 0 y menor que el precio de lista", () => {
    const amt = (v: string, price = 500_000) =>
      parseOfferInput({ choice: "custom", customKind: "amount", customValue: v }, price);
    expect(amt("12000")).toEqual({ ok: true, offer: { type: "amount", amount: 12_000 } });
    expect(amt("$12,500")).toEqual({ ok: true, offer: { type: "amount", amount: 12_500 } });
    for (const bad of ["0", "500000", "600000", "-5", "x"]) expect(amt(bad), bad).toEqual({ ok: false, error: "amount_range" });
    // Sin precio de lista no hay tope con qué comparar: se rechaza.
    expect(amt("1000", 0)).toEqual({ ok: false, error: "amount_range" });
  });
});

describe("oferta guardada", () => {
  it("ida y vuelta por las columnas de properties", () => {
    for (const offer of [
      { type: "none" } as const,
      { type: "percent", pct: 2.5 } as const,
      { type: "amount", amount: 9_000 } as const,
    ]) {
      expect(offerFromRow(offerToRow(offer))).toEqual(offer);
    }
  });

  it("filas anteriores a la migración: 2.5 sin tipo = porcentaje; 0 sin tipo = sin elegir", () => {
    expect(offerFromRow({ buyer_agent_comp_type: null, buyer_agent_commission: 2.5, buyer_agent_comp_amount: null }))
      .toEqual({ type: "percent", pct: 2.5 });
    expect(offerFromRow({ buyer_agent_comp_type: null, buyer_agent_commission: 0, buyer_agent_comp_amount: null })).toBeNull();
    expect(offerFromRow({ buyer_agent_comp_type: null, buyer_agent_commission: "3.00", buyer_agent_comp_amount: null }))
      .toEqual({ type: "percent", pct: 3 });
  });

  it("solo Concierge trae 3% preseleccionado", () => {
    expect(suggestedOffer("concierge")).toEqual({ type: "percent", pct: 3 });
    expect(suggestedOffer("pro")).toBeNull();
    expect(suggestedOffer("essentials")).toBeNull();
    expect(offerChoice(suggestedOffer("concierge"))).toBe("3");
    expect(offerChoice(null)).toBe("");
    expect(offerChoice({ type: "percent", pct: 2.75 })).toBe("custom");
  });

  it("formato con punto decimal y USD", () => {
    expect(formatOffer({ type: "none" })).toBe("0%");
    expect(formatOffer({ type: "percent", pct: 2.5 })).toBe("2.5%");
    expect(formatOffer({ type: "amount", amount: 12_000 })).toBe("$12,000");
  });
});

describe("acuerdo de compensación (CASSB-1)", () => {
  it("0% genera cero CASSB-1; cualquier oferta > 0 genera uno", () => {
    expect(compensationAgreementsFor({ type: "none" })).toBe(0);
    expect(compensationAgreementsFor(null)).toBe(0);
    expect(compensationAgreementsFor({ type: "percent", pct: 2 })).toBe(1);
    expect(compensationAgreementsFor({ type: "amount", amount: 5_000 })).toBe(1);
  });

  it("campos de la plantilla: % en fee_pct_value, USD en fee_amount; nada con 0%", () => {
    expect(cassb1Tabs({ type: "none" })).toBeNull();
    expect(cassb1Tabs({ type: "percent", pct: 2.5 })).toEqual({ fee_pct_value: "2.5" });
    expect(cassb1Tabs({ type: "amount", amount: 12_000 })).toEqual({ fee_amount: "12,000" });
  });

  // La exportación de DocuSign está en .gitignore (docs/docusign/): el caso corre solo donde existe.
  const CASSB1_EXPORT = "docs/docusign/lixtara-templates-2026-09-27/lixtara-compensation-agreement-CASSB-1.json";
  it.skipIf(!existsSync(join(ROOT, CASSB1_EXPORT)))("los campos existen en la plantilla CASSB-1 exportada", () => {
    const tpl = read(CASSB1_EXPORT);
    for (const label of ["fee_amount", "fee_pct_value"]) expect(tpl).toContain(`"tabLabel": "${label}"`);
  });

  it("el acuerdo de listado marca buyer_commission_ack solo con oferta > 0", () => {
    expect(buyerCommissionAck({ type: "none" })).toBe(false);
    expect(buyerCommissionAck({ type: "percent", pct: 3 })).toBe(true);
    expect(buyerCommissionAck({ type: "amount", amount: 1 })).toBe(true);
    const route = read("src/app/api/agreement/create/route.ts");
    expect(route).toContain("buyer_commission_ack: buyerCommissionAck(buyerOffer)");
    expect(route).not.toMatch(/buyer_commission_ack:\s*true/);
    expect(route).toContain('error: "buyer_comp_not_set"');
  });
});

describe("paso 6 en el asistente", () => {
  const wizard = read("src/app/[lang]/listing/new/page.tsx");

  it("ya no exige una comisión > 0 ni fuerza el 3% de Concierge", () => {
    expect(wizard).not.toContain("buyer_commission_required");
    expect(wizard).not.toContain("invalid_buyer_commission");
    expect(wizard).not.toMatch(/update\(\{\s*buyer_agent_commission:\s*3\s*\}\)/);
    expect(wizard).not.toContain("setBuyerCommission");
  });

  it("guarda tipo, valor y versión del texto al continuar", () => {
    const i = wizard.indexOf("async function nextFromStep6");
    const body = wizard.slice(i, wizard.indexOf("\n  }\n", i));
    expect(body).toContain("parseOfferInput(");
    expect(body).toContain("buyer_agent_comp_type: row.buyer_agent_comp_type");
    expect(body).toContain("buyer_agent_comp_amount: row.buyer_agent_comp_amount");
    expect(body).toContain("buyer_agent_comp_terms_version: BUYER_COMP_TERMS_VERSION");
  });
});

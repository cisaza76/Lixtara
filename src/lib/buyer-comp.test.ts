import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BUYER_COMP_MAX_PCT,
  buyerCompMaxAmount,
  offerWithinLimit,
  buyerCommissionAck,
  CASSB1_ENABLED,
  cassb1Tabs,
  compensationAgreementsFor,
  formatOffer,
  offerChoice,
  offerFromRow,
  offerToRow,
  parseOfferInput,
  suggestedOffer,
} from "@/lib/buyer-comp";
import { dictionaries } from "@/lib/i18n";

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

  it("porcentaje personalizado: mayor que 0 y hasta 3 (regla de Lixtara)", () => {
    const pct = (v: string) => parseOfferInput({ choice: "custom", customKind: "percent", customValue: v }, 500_000);
    expect(pct("2.75")).toEqual({ ok: true, offer: { type: "percent", pct: 2.75 } });
    expect(pct("3")).toEqual({ ok: true, offer: { type: "percent", pct: 3 } });
    expect(pct("0.01")).toEqual({ ok: true, offer: { type: "percent", pct: 0.01 } });
    expect(pct("1.5%")).toEqual({ ok: true, offer: { type: "percent", pct: 1.5 } });
    for (const bad of ["0", "-1", "abc", "", "2,5"]) expect(pct(bad), bad).toEqual({ ok: false, error: "pct_range" });
    for (const over of ["3.01", "3.5", "6"]) expect(pct(over), over).toEqual({ ok: false, error: "pct_max" });
    expect(BUYER_COMP_MAX_PCT).toBe(3);
  });

  it("monto fijo: mayor que 0 y hasta el 3% del precio de lista", () => {
    const amt = (v: string, price = 500_000) =>
      parseOfferInput({ choice: "custom", customKind: "amount", customValue: v }, price);
    expect(buyerCompMaxAmount(500_000)).toBe(15_000);
    expect(buyerCompMaxAmount(333_333)).toBe(9_999.99);
    expect(amt("12000")).toEqual({ ok: true, offer: { type: "amount", amount: 12_000 } });
    expect(amt("$12,500")).toEqual({ ok: true, offer: { type: "amount", amount: 12_500 } });
    expect(amt("15000")).toEqual({ ok: true, offer: { type: "amount", amount: 15_000 } });
    for (const bad of ["0", "-5", "x"]) expect(amt(bad), bad).toEqual({ ok: false, error: "amount_range" });
    for (const over of ["15000.01", "20000", "500000"]) expect(amt(over), over).toEqual({ ok: false, error: "amount_max" });
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

describe("tope de Lixtara con el precio de lista actual (agreement/create)", () => {
  it("0% siempre; % hasta 3; monto hasta el 3% del precio de hoy", () => {
    expect(offerWithinLimit({ type: "none" }, 0)).toBe(true);
    expect(offerWithinLimit({ type: "percent", pct: 3 }, 400_000)).toBe(true);
    expect(offerWithinLimit({ type: "percent", pct: 4 }, 400_000)).toBe(false);
    expect(offerWithinLimit({ type: "amount", amount: 15_000 }, 500_000)).toBe(true);
    // Bajó el precio después del paso 6: $15,000 ya es más del 3% de $400,000.
    expect(offerWithinLimit({ type: "amount", amount: 15_000 }, 400_000)).toBe(false);
  });

  it("la ruta lo revisa y manda de vuelta al paso 6", () => {
    const route = read("src/app/api/agreement/create/route.ts");
    expect(route).toContain("offerWithinLimit(buyerOffer, Number(property.list_price))");
    expect(route).toContain('step6("buyer_comp_over_limit")');
  });

  it.each(["en", "es"] as const)("%s: los mensajes del tope hablan de Lixtara, no de leyes ni del MLS", (lang) => {
    const c = dictionaries[lang].listingForm.step6.buyerComp;
    const s = dictionaries[lang].savings;
    const msgs = [c.pctRange, c.pctMax, c.amountRange, c.amountMax, c.overLimit, c.customPercentHelp, c.customAmountHelp, s.buyerCompPctMax, s.buyerCompAmountMax];
    for (const m of msgs) expect(m).not.toMatch(/\blaw\b|\blegal\b|\bley(es)?\b|\bMLS\b|\brule|\bregla/i);
    expect(c.pctMax).toBe(lang === "en" ? "Lixtara allows up to {max}%." : "El máximo que permite Lixtara es {max}%.");
    expect(s.buyerCompPctMax).toBe(lang === "en" ? "Lixtara allows up to {max}%." : "El máximo que permite Lixtara es {max}%.");
  });
});

describe("acuerdo de compensación (CASSB-1)", () => {
  it("0% genera cero CASSB-1; cualquier oferta > 0 genera uno", () => {
    expect(compensationAgreementsFor({ type: "none" })).toBe(0);
    expect(compensationAgreementsFor(null)).toBe(0);
    expect(compensationAgreementsFor({ type: "percent", pct: 2 })).toBe(1);
    expect(compensationAgreementsFor({ type: "amount", amount: 5_000 })).toBe(1);
  });

  it.skipIf(!CASSB1_ENABLED)("campos de la plantilla: % en fee_pct_value, USD en fee_amount; nada con 0%", () => {
    expect(cassb1Tabs({ type: "none" })).toBeNull();
    expect(cassb1Tabs({ type: "percent", pct: 2.5 })).toEqual({ fee_pct_value: "2.5" });
    expect(cassb1Tabs({ type: "amount", amount: 12_000 })).toEqual({ fee_amount: "12,000" });
  });

  // Apagado hasta nuevo aviso (2026-10-18): se confirma si corresponde el CASSB-1 o un acuerdo
  // de compensación del vendedor al broker del comprador.
  it("CASSB-1 apagado: no se generan campos ni se sugiere en el admin ni en la hoja de Matrix", () => {
    expect(CASSB1_ENABLED).toBe(false);
    expect(cassb1Tabs({ type: "percent", pct: 2.5 })).toBeNull();
    expect(cassb1Tabs({ type: "amount", amount: 12_000 })).toBeNull();
    const review = read("src/app/[lang]/admin/listings/[id]/review/page.tsx");
    expect(review).toMatch(/\{CASSB1_ENABLED &&\s*field\(\s*"CASSB-1"/);
    const sheet = read("src/lib/matrix-input-sheet.ts");
    expect(sheet).toContain('${CASSB1_ENABLED ? " (CASSB-1)" : ""}');
    // Nadie más genera el CASSB-1: cassb1Tabs no tiene llamadas fuera de su módulo y los tests.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
      );
    const callers = walk(join(ROOT, "src"))
      .filter((f) => !f.endsWith("buyer-comp.ts") && !f.includes(".test."))
      .filter((f) => readFileSync(f, "utf8").includes("cassb1Tabs"));
    expect(callers).toEqual([]);
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
    // Los valores del contrato salen de listingAgreementTabs (src/lib/docusign/).
    const tabs = read("src/lib/docusign/listing-agreement-tabs.ts");
    expect(tabs).toContain("buyer_commission_ack: buyerCommissionAck(buyerOffer)");
    expect(tabs).not.toMatch(/buyer_commission_ack:\s*true/);
    expect(read("src/app/api/agreement/create/route.ts")).toContain('error: "buyer_comp_not_set"');
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

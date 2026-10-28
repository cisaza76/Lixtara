// Números escritos por el vendedor (regla 2026-10-27): "1,854" en pies² se guardaba como 1
// (parseInt corta en la coma) y llegaba al MLS. Coma de miles y "$" se aceptan y se quitan;
// nunca se lee un número a medias. El navegador (atributo pattern) y el servidor
// (parseFormNumber) usan la misma expresión.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NUMBER_PATTERNS, parseFormNumber, type NumberKind } from "@/lib/form-numbers";
import { parseOfferInput } from "@/lib/buyer-comp";
import { normalizeFieldValue } from "@/lib/listing-requests";
import { t } from "@/lib/i18n";
import { listingErrorField } from "@/lib/analytics";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");
const page = src("src/app/[lang]/listing/new/page.tsx");

/** Como lo evalúa el navegador: ^(?:patrón)$ con la bandera v (HTML, atributo pattern). */
const browser = (kind: NumberKind) => {
  const re = new RegExp(`^(?:${NUMBER_PATTERNS[kind]})$`, "v");
  return (v: string) => re.test(v);
};
const value = (raw: string, kind: NumberKind) => {
  const r = parseFormNumber(raw, kind);
  return r.ok ? r.value : "error";
};

describe("parseFormNumber: coma de miles y $ se quitan; nunca un número a medias", () => {
  it.each<[string, NumberKind, number]>([
    ["1,854", "positiveWhole", 1854],
    ["1854", "positiveWhole", 1854],
    [" 1,854 ", "positiveWhole", 1854],
    ["107,158", "whole", 107158],
    ["0", "whole", 0],
    ["$500,000", "moneyWhole", 500000],
    ["500,000", "moneyWhole", 500000],
    ["$ 1,250,000", "moneyWhole", 1250000],
    ["500000.00", "moneyWhole", 500000],
    ["$9,270", "moneyWhole", 9270],
    ["$2,500.50", "money", 2500.5],
    ["2500", "money", 2500],
    ["2,5", "bathrooms", 2.5],
    ["2.5", "bathrooms", 2.5],
    [",5", "bathrooms", 0.5],
    ["3", "bathrooms", 3],
  ])("%j (%s) → %d", (raw, kind, want) => {
    expect(value(raw, kind)).toBe(want);
    expect(browser(kind)(raw)).toBe(true);
  });

  it.each<[string, NumberKind]>([
    ["18,54", "positiveWhole"], // comas mal agrupadas: no se adivina
    ["1,85", "positiveWhole"],
    ["1854abc", "positiveWhole"], // parseInt daba 1854
    ["1.854", "positiveWhole"], // punto como miles: no es un entero
    ["12.5", "positiveWhole"],
    ["0", "positiveWhole"],
    ["0,000", "positiveWhole"],
    ["-5", "whole"],
    ["1e3", "whole"],
    ["$350.50", "moneyWhole"], // columna entera: no se redondea
    ["500,000.5", "moneyWhole"],
    ["$2,500.505", "money"],
    ["2,500,0", "money"],
    ["$", "money"],
    ["2,5,0", "bathrooms"],
    ["2.5.1", "bathrooms"],
    ["0", "bathrooms"],
    ["0,0", "bathrooms"],
    ["1,500", "bathrooms"], // baños no tienen miles: 1.5 sería otra lectura de lo escrito
  ])("%j (%s) → error del campo", (raw, kind) => {
    if (raw !== "1,500") expect(value(raw, kind)).toBe("error");
    expect(browser(kind)(raw)).toBe(raw === "1,500");
  });

  it("vacío → null (campos opcionales)", () => {
    expect(parseFormNumber("", "whole")).toEqual({ ok: true, value: null });
    expect(parseFormNumber("   ", "money")).toEqual({ ok: true, value: null });
    expect(parseFormNumber(null, "moneyWhole")).toEqual({ ok: true, value: null });
  });
});

describe("paso 3: navegador y servidor con la misma regla", () => {
  it("el servidor ya no usa parseInt / parseFloat / Number() sobre los campos del formulario", () => {
    const save = page.slice(page.indexOf("async function saveStep3("), page.indexOf("async function autofillStep3("));
    expect(save).not.toMatch(/parseInt|parseFloat|Number\(rentRaw\)/);
    for (const [name, kind] of [
      ["bedrooms", "whole"], ["bathrooms", "bathrooms"], ["sqft", "positiveWhole"], ["lot_size", "whole"],
      ["year_built", "whole"], ["list_price", "moneyWhole"], ["parking_spaces", "whole"],
      ["hoa_fee", "moneyWhole"], ["tax_annual_amount", "moneyWhole"], ["monthly_rent", "money"],
    ]) {
      expect(save, name).toContain(`num("${name}", "${kind}")`);
    }
  });

  it("cada campo numérico lleva el patrón de su tipo en el navegador", () => {
    const fieldPattern = (name: string) => {
      const i = page.indexOf(`name="${name}"`);
      return page.slice(i, i + 700).match(/pattern=\{NUMBER_PATTERNS\.(\w+)\}/)?.[1];
    };
    expect(fieldPattern("bedrooms")).toBe("whole");
    expect(fieldPattern("bathrooms")).toBe("bathrooms");
    expect(fieldPattern("sqft")).toBe("positiveWhole");
    expect(fieldPattern("lot_size")).toBe("whole");
    expect(fieldPattern("year_built")).toBe("whole");
    expect(fieldPattern("list_price")).toBe("moneyWhole");
    expect(fieldPattern("parking_spaces")).toBe("whole");
    expect(fieldPattern("hoa_fee")).toBe("moneyWhole");
    expect(fieldPattern("tax_annual_amount")).toBe("moneyWhole");
    const occupancy = src("src/components/occupancy-section.tsx");
    expect(occupancy).toMatch(/type="text"\s*name="monthly_rent"\s*pattern=\{NUMBER_PATTERNS\.money\}/);
    expect(src("src/components/auth-shell.tsx")).toContain("pattern={pattern}");
  });

  it("mismo mensaje por campo que el servidor (EN/ES) y en el mismo intento", () => {
    const map: Record<string, [string, string]> = {
      bedrooms: ["invalidBeds", "invalid_beds"],
      bathrooms: ["invalidBaths", "invalid_baths"],
      sqft: ["invalidSqft", "invalid_sqft"],
      year_built: ["invalidYear", "invalid_year"],
      lot_size: ["invalidLot", "invalid_lot"],
      list_price: ["invalidPrice", "invalid_price"],
      parking_spaces: ["invalidParking", "invalid_parking"],
      hoa_fee: ["invalidHoa", "invalid_hoa"],
      tax_annual_amount: ["invalidTax", "invalid_tax"],
      monthly_rent: ["invalidRent", "invalid_rent"],
    };
    for (const [field, [key, code]] of Object.entries(map)) {
      expect(page, field).toContain(`${field}: copy.stepErrors.${key},`);
      expect(page, code).toContain(`error=${code}`);
      expect(listingErrorField(code), code).toBe(field);
      for (const lang of ["en", "es"] as const) {
        expect((t(lang).listingForm.stepErrors as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
      }
    }
    expect(page).toContain("invalidMessages={step3InvalidMessages}");
    const component = src("src/components/app-form-validation.tsx");
    expect(component).toMatch(/\(el\.validity\.patternMismatch && invalidMessages\[el\.name\]\)/);
    expect(component).toContain("for (const el of invalid)");
    // El precio ya no dice "sin comas".
    expect(t("es").listingForm.stepErrors.invalidPrice).not.toMatch(/sin comas/);
    expect(t("en").listingForm.stepErrors.invalidPrice).not.toMatch(/no commas/);
  });
});

describe("paso 6: compensación personalizada en monto", () => {
  const offer = (customKind: string, customValue: string) =>
    parseOfferInput({ choice: "custom", customKind, customValue }, 450_000);

  it("acepta coma de miles y $", () => {
    expect(offer("amount", "$5,000")).toEqual({ ok: true, offer: { type: "amount", amount: 5000 } });
    expect(offer("amount", "5,000.50")).toEqual({ ok: true, offer: { type: "amount", amount: 5000.5 } });
  });
  it("antes '5,00' se leía como 500: ahora es error", () => {
    expect(offer("amount", "5,00")).toEqual({ ok: false, error: "amount_range" });
    expect(offer("amount", "12abc")).toEqual({ ok: false, error: "amount_range" });
  });
  it("porcentaje: '2,5' sigue sin leerse como 25 %", () => {
    expect(offer("percent", "2,5")).toEqual({ ok: false, error: "pct_range" });
    expect(offer("percent", "2.5%")).toEqual({ ok: true, offer: { type: "percent", pct: 2.5 } });
  });
});

describe("solicitudes de cambio (listing ya enviado)", () => {
  it("acepta coma de miles y $ en el texto del vendedor", () => {
    expect(normalizeFieldValue("sqft", "1,854")).toBe(1854);
    expect(normalizeFieldValue("list_price", "$450,000")).toBe(450000);
    expect(normalizeFieldValue("hoa_fee", "1,500")).toBe(1500);
    expect(normalizeFieldValue("lot_size", "7,500")).toBe(7500);
    expect(normalizeFieldValue("bathrooms", "2,5")).toBe(2.5);
  });
  it("nunca un número a medias", () => {
    expect(normalizeFieldValue("sqft", "1,85")).toBeUndefined();
    expect(normalizeFieldValue("sqft", "1854abc")).toBeUndefined();
    expect(normalizeFieldValue("list_price", "$450,000.75")).toBeUndefined();
  });
  it("el formulario usa texto, no type=number (con '1,500' el navegador entregaba '' y se pedía borrar el valor)", () => {
    const form = src("src/components/listing-request-forms.tsx");
    expect(form).not.toMatch(/"number"\}/);
    expect(form).toContain('type="text"\n                  inputMode=');
  });
});

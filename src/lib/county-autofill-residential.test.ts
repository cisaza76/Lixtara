// Autollenado del condado: solo viviendas (regla 2026-10-27). Caso real: el borrador is_test
// ed8132ef (200 South Biscayne Blvd) recibió los datos de un edificio de oficinas — impuesto
// $8,100,000, "Single family", año 1984, lote 107,158 pies².
// Las respuestas simuladas son extractos REALES de GetAddress / GetPropertySearchByFolio
// (2026-10-27).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COUNTY_TAX_AUTOFILL_MAX_USD,
  acceptCountyTax,
  lookupMiamiDadeProperty,
  step3PropertyTypeDefault,
  unitFromStoredStreet,
} from "@/lib/miami-dade";
import { dictionaries } from "@/lib/i18n";

interface Parcel {
  candidate: { Strap: string; SiteAddress: string; SiteUnit: string };
  info: Record<string, unknown>;
  taxable: number;
  legal: string;
}

const BISCAYNE_200: Parcel = {
  candidate: { Strap: "01-0114-030-1350", SiteAddress: "200 S BISCAYNE BLVD", SiteUnit: "" },
  info: {
    DORCode: "1813",
    DORDescription: "OFFICE BUILDING - MULTISTORY : OFFICE BUILDING",
    BedroomCount: 0, BathroomCount: 0, HalfBathroomCount: 0,
    LotSize: 107158, YearBuilt: "1984", UnitCount: 0, BuildingEffectiveArea: 2039308,
  },
  taxable: 405_000_000,
  legal: "DUPONT PLAZA|PB 50-11|ALL OF BLK 5",
};

const NW_30_TER_10279: Parcel = {
  candidate: { Strap: "35-3029-114-0580", SiteAddress: "10279 NW 30 TER", SiteUnit: "" },
  info: {
    DORCode: "0410",
    DORDescription: "RESIDENTIAL - TOTAL VALUE : TOWNHOUSE",
    BedroomCount: 3, BathroomCount: 2, HalfBathroomCount: 1,
    LotSize: 1495, YearBuilt: "2006", UnitCount: 1, BuildingEffectiveArea: 1854,
  },
  taxable: 463_402,
  legal: "BEACON AT DORAL|PB 164-063|LOT 8  BLK 8",
};

const BRICKELL_500_3001: Parcel = {
  candidate: { Strap: "01-4138-144-0640", SiteAddress: "500 BRICKELL AVE", SiteUnit: "3001" },
  info: {
    DORCode: "0407",
    DORDescription: "RESIDENTIAL - TOTAL VALUE : CONDOMINIUM - RESIDENTIAL",
    BedroomCount: 3, BathroomCount: 2, HalfBathroomCount: 0,
    LotSize: 0, YearBuilt: "2008", UnitCount: 1, BuildingEffectiveArea: 1494,
  },
  taxable: 773_899,
  legal: "500 BRICKELL EAST CONDO|UNIT 3001",
};

function stubCounty(parcel: Parcel) {
  const body = (url: string) =>
    url.includes("Operation=GetAddress")
      ? { MinimumPropertyInfos: [parcel.candidate] }
      : {
          PropertyInfo: parcel.info,
          Building: { BuildingInfos: [] },
          Taxable: { TaxableInfos: [{ Year: 2026, CountyTaxableValue: parcel.taxable }] },
          LegalDescription: { Description: parcel.legal },
        };
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    text: async () => JSON.stringify(body(String(url))),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupMiamiDadeProperty: solo viviendas", () => {
  it("200 S Biscayne Blvd (1813, oficinas) → no residencial, sin datos ni folio", async () => {
    stubCounty(BISCAYNE_200);
    const r = await lookupMiamiDadeProperty("200 South Biscayne Boulevard", "33131", null);
    expect(r).toEqual({ found: false, nonResidential: true });
  });

  it("10279 NW 30th Ter (0410) → townhouse con sus datos", async () => {
    stubCounty(NW_30_TER_10279);
    const r = await lookupMiamiDadeProperty("10279 Northwest 30th Terrace", "33172", null);
    expect(r.found).toBe(true);
    expect(r.folio).toBe("3530291140580");
    expect(r.details).toMatchObject({
      property_type: "townhouse",
      bedrooms: 3,
      bathrooms: 2.5,
      sqft: 1854,
      lot_size: 1495,
      year_built: 2006,
      tax_annual_amount: 9270,
    });
  });

  it("500 Brickell Ave #3001 (0407) → condominio de esa unidad", async () => {
    const street = "500 Brickell Ave, Unit 3001";
    stubCounty(BRICKELL_500_3001);
    const r = await lookupMiamiDadeProperty("500 Brickell Ave", "33131", unitFromStoredStreet(street));
    expect(r.found).toBe(true);
    expect(r.folio).toBe("0141381440640");
    expect(r.details).toMatchObject({ property_type: "condo", bedrooms: 3, sqft: 1494, year_built: 2008 });
    expect(r.details?.lot_size).toBeNull();
  });

  it("sin código de uso → como no encontrada (no se sabe qué es)", async () => {
    stubCounty({ ...NW_30_TER_10279, info: { ...NW_30_TER_10279.info, DORCode: "" } });
    const r = await lookupMiamiDadeProperty("10279 NW 30th Ter", "33172", null);
    expect(r).toEqual({ found: false });
  });
});

describe("acceptCountyTax: topes del impuesto estimado", () => {
  it("el impuesto de 200 S Biscayne ($8,100,000) nunca se autollena", () => {
    expect(acceptCountyTax(8_100_000, 0)).toBeNull();
    expect(acceptCountyTax(8_100_000, 500_000_000)).toBeNull();
  });
  it("tope fijo de $200,000", () => {
    expect(acceptCountyTax(COUNTY_TAX_AUTOFILL_MAX_USD, 0)).toBe(COUNTY_TAX_AUTOFILL_MAX_USD);
    expect(acceptCountyTax(COUNTY_TAX_AUTOFILL_MAX_USD + 10, 0)).toBeNull();
  });
  it("no más del 5 % del precio de lista", () => {
    expect(acceptCountyTax(9270, 450_000)).toBe(9270);
    expect(acceptCountyTax(22_500, 450_000)).toBe(22_500);
    expect(acceptCountyTax(22_510, 450_000)).toBeNull();
  });
  it("sin precio todavía (0), solo el tope fijo", () => {
    expect(acceptCountyTax(15_480, 0)).toBe(15_480);
    expect(acceptCountyTax(15_480, null)).toBe(15_480);
  });
  it("vacío o no positivo → null", () => {
    expect(acceptCountyTax(null, 0)).toBeNull();
    expect(acceptCountyTax(0, 0)).toBeNull();
    expect(acceptCountyTax(Number.NaN, 0)).toBeNull();
  });
});

describe("step3PropertyTypeDefault: nunca 'Single family' sin confirmar", () => {
  const fresh = { property_type: "single_family", sqft: 0, bedrooms: 0, year_built: null, address_street: "200 S Biscayne Blvd" };

  it("borrador recién creado, sin unidad → sin selección (el vendedor elige)", () => {
    expect(step3PropertyTypeDefault(fresh, false)).toBe("");
  });
  it("parcela no residencial → sin selección, aunque la dirección tenga unidad", () => {
    expect(step3PropertyTypeDefault(fresh, true)).toBe("");
    expect(step3PropertyTypeDefault({ ...fresh, property_type: "condo", address_street: "200 S Biscayne Blvd, Unit 400" }, true)).toBe("");
  });
  it("con unidad y sin dato del condado → Condo (decisión 2026-10-17)", () => {
    expect(step3PropertyTypeDefault({ ...fresh, property_type: "condo", address_street: "500 Brickell Ave, Unit 3001" }, false)).toBe("condo");
  });
  it("confirmado por el condado o guardado por el vendedor → el valor guardado", () => {
    expect(step3PropertyTypeDefault({ ...fresh, property_type: "townhouse", sqft: 1854, bedrooms: 3, year_built: 2006 }, false)).toBe("townhouse");
    expect(step3PropertyTypeDefault({ ...fresh, sqft: 1500 }, false)).toBe("single_family");
  });
});

describe("el paso 3 usa los controles", () => {
  const page = readFileSync(join(process.cwd(), "src/app/[lang]/listing/new/page.tsx"), "utf8");

  it("el autollenado automático y el botón respetan 'no residencial' y los topes del impuesto", () => {
    expect(page).toMatch(/if \(result\.nonResidential\) \{\s*step3NonResidential = true;\s*return;/);
    expect(page).toContain("autofill=nonresidential");
    expect(page.match(/acceptCountyTax\(d\.tax_annual_amount/g)).toHaveLength(2);
    expect(page).not.toMatch(/tax_annual_amount = d\.tax_annual_amount/);
  });

  it("el tipo de propiedad no tiene 'single_family' por defecto: placeholder y required", () => {
    expect(page).not.toContain('defaultValue={draft?.property_type ?? "single_family"}');
    expect(page).toMatch(/name="property_type"\s*required\s*defaultValue=\{propertyTypeDefault\}/);
    expect(page).toMatch(/<option value="" disabled>\s*\{copy\.step3\.propertyTypePlaceholder\}/);
  });

  it("el aviso existe en EN y ES con el texto acordado", () => {
    expect(dictionaries.es.listingForm.step3.autofillNonResidential).toBe(
      "Esta dirección figura en el condado como propiedad no residencial. Completa los datos a mano; la broker los verifica.",
    );
    expect(dictionaries.en.listingForm.step3.autofillNonResidential).toMatch(/non-residential/);
  });
});

// Datos del condado que quedan de otra parcela (regla 2026-10-27). Caso real: el borrador is_test
// ed8132ef conservó, tras la consulta "no residencial", el folio, la descripción legal, el
// impuesto $8.1M, el año y el lote de 200 S Biscayne Blvd; un vendedor que corrige la dirección
// de A a B se quedaba con los datos y el folio de A.
// Respuestas simuladas: extractos REALES de GetAddress / GetPropertySearchByFolio (2026-10-27).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countyLookupMiss,
  countyParcelByFolio,
  lookupMiamiDadeProperty,
  staleCountyColumns,
  staleCountyUpdates,
  verifiedLegalDescription,
  type CountyFilledColumns,
  type MiamiDadeDetails,
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
    DORCode: "1813", DORDescription: "OFFICE BUILDING - MULTISTORY : OFFICE BUILDING",
    BedroomCount: 0, BathroomCount: 0, HalfBathroomCount: 0,
    LotSize: 107158, YearBuilt: "1984", UnitCount: 0, BuildingEffectiveArea: 2039308,
  },
  taxable: 405_000_000,
  legal: "DUPONT PLAZA|PB 50-11|ALL OF BLK 5",
};

const NW_30_TER_10279: Parcel = {
  candidate: { Strap: "35-3029-114-0580", SiteAddress: "10279 NW 30 TER", SiteUnit: "" },
  info: {
    DORCode: "0410", DORDescription: "RESIDENTIAL - TOTAL VALUE : TOWNHOUSE",
    BedroomCount: 3, BathroomCount: 2, HalfBathroomCount: 1,
    LotSize: 1495, YearBuilt: "2006", UnitCount: 1, BuildingEffectiveArea: 1854,
  },
  taxable: 463_402,
  legal: "BEACON AT DORAL|PB 164-063|LOT 8  BLK 8",
};

// Multifamiliar de 24 unidades (clase 03): extracto del condado con número y calle de prueba.
const MULTI_24: Parcel = {
  candidate: { Strap: "01-3135-000-0000", SiteAddress: "1500 NW 7 ST", SiteUnit: "" },
  info: {
    DORCode: "0303", DORDescription: "MULTIFAMILY 10 UNITS PLUS : MULTIFAMILY 3 OR MORE UNITS",
    BedroomCount: 40, BathroomCount: 24, HalfBathroomCount: 0,
    LotSize: 15000, YearBuilt: "1962", UnitCount: 24, BuildingEffectiveArea: 19800,
  },
  taxable: 2_400_000,
  legal: "TEST SUB|PB 1-1|LOT 1",
};

const PARCELS = [BISCAYNE_200, NW_30_TER_10279, MULTI_24];
const folioOf = (p: Parcel) => p.candidate.Strap.replace(/-/g, "");

/** Condado simulado: GetAddress por número de casa, GetPropertySearchByFolio por folio. */
function stubCounty(opts: { addressDown?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.searchParams.get("Operation") === "GetAddress") {
        if (opts.addressDown) return { ok: false, status: 503, text: async () => "" };
        const number = (u.searchParams.get("myAddress") ?? "").split(" ")[0];
        const hits = PARCELS.filter((p) => p.candidate.SiteAddress.startsWith(`${number} `));
        return { ok: true, text: async () => JSON.stringify({ MinimumPropertyInfos: hits.map((p) => p.candidate) }) };
      }
      const parcel = PARCELS.find((p) => folioOf(p) === u.searchParams.get("folioNumber"));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            PropertyInfo: parcel?.info,
            Building: { BuildingInfos: [] },
            Taxable: { TaxableInfos: [{ Year: 2026, CountyTaxableValue: parcel?.taxable }] },
            LegalDescription: { Description: parcel?.legal },
          }),
      };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Borrador con TODO lo que el condado llenó para 10279 NW 30 Ter (antes de #236). */
const filledFrom10279 = (street: string): CountyFilledColumns & { folio: string } => ({
  address_street: street,
  folio: folioOf(NW_30_TER_10279),
  property_type: "townhouse",
  bedrooms: 3,
  bathrooms: 2.5,
  sqft: 1854,
  lot_size: 1495,
  year_built: 2006,
  tax_annual_amount: 9270,
  legal_description: "BEACON AT DORAL\nPB 164-063\nLOT 8  BLK 8",
});

const ALL_CLEARED = {
  folio: null,
  bedrooms: 0,
  bathrooms: 0,
  sqft: 0,
  lot_size: null,
  year_built: null,
  tax_annual_amount: null,
  legal_description: null,
  property_type: "single_family",
};

describe("la consulta borra lo que vino de otra parcela", () => {
  it("dirección corregida a una parcela NO residencial (200 S Biscayne) → se borra todo lo de 10279", async () => {
    stubCounty();
    const draft = filledFrom10279("200 S Biscayne Blvd");
    const r = await lookupMiamiDadeProperty("200 S Biscayne Blvd", "33131", null);
    expect(r.nonResidential).toBe(true);
    expect(await staleCountyUpdates(draft, r)).toEqual(ALL_CLEARED);
  });

  it("dirección corregida a un edificio de 5+ unidades → se borra todo lo de 10279", async () => {
    stubCounty();
    const r = await lookupMiamiDadeProperty("1500 NW 7th St", "33125", null);
    expect(r.largeMultifamily).toBe(true);
    expect(await staleCountyUpdates(filledFrom10279("1500 NW 7th St"), r)).toEqual(ALL_CLEARED);
  });

  it("dirección corregida a una NO encontrada → se borra todo lo de 10279", async () => {
    stubCounty();
    const r = await lookupMiamiDadeProperty("777 Nowhere Ave", "33131", null);
    expect(countyLookupMiss(r)).toBe(true);
    expect(await staleCountyUpdates(filledFrom10279("777 Nowhere Ave"), r)).toEqual(ALL_CLEARED);
  });

  it("lo que el vendedor editó a mano se conserva (habitaciones, impuesto, tipo)", async () => {
    stubCounty();
    const draft = { ...filledFrom10279("200 S Biscayne Blvd"), bedrooms: 4, tax_annual_amount: 9500, property_type: "single_family" };
    const r = await lookupMiamiDadeProperty("200 S Biscayne Blvd", "33131", null);
    const out = await staleCountyUpdates(draft, r);
    expect(out).toEqual({ folio: null, bathrooms: 0, sqft: 0, lot_size: null, year_built: null, legal_description: null });
  });

  it("ed8132ef: lo que quedó de 200 S Biscayne (impuesto $8.1M, 1984, lote, descripción legal) se borra; el tipo, que no vino del condado, no", async () => {
    stubCounty();
    const draft: CountyFilledColumns & { folio: string } = {
      address_street: "200 S Biscayne Blvd",
      folio: folioOf(BISCAYNE_200),
      property_type: "single_family",
      bedrooms: 0,
      bathrooms: 1,
      sqft: 0,
      lot_size: 107158,
      year_built: 1984,
      tax_annual_amount: 8_100_000,
      legal_description: "DUPONT PLAZA\nPB 50-11\nALL OF BLK 5",
    };
    const r = await lookupMiamiDadeProperty("200 S Biscayne Blvd", "33131", null);
    expect(await staleCountyUpdates(draft, r)).toEqual({
      folio: null,
      lot_size: null,
      year_built: null,
      tax_annual_amount: null,
      legal_description: null,
    });
  });

  it("dirección corregida a OTRA vivienda: también se borra lo de A (el botón o el borrador vacío llenan B)", async () => {
    stubCounty();
    const draft = { ...filledFrom10279("1500 NW 7th St"), folio: folioOf(BISCAYNE_200) };
    const r = await lookupMiamiDadeProperty("10279 NW 30th Ter", "33172", null);
    expect(r.found).toBe(true);
    const out = await staleCountyUpdates(draft, r);
    expect(out.folio).toBeNull();
  });

  it("misma parcela confirmada → nada", async () => {
    stubCounty();
    const r = await lookupMiamiDadeProperty("10279 NW 30th Ter", "33172", null);
    expect(await staleCountyUpdates(filledFrom10279("10279 NW 30th Ter"), r)).toEqual({});
  });

  it("el condado falla → error, no 'no encontrada': no se borra nada", async () => {
    stubCounty({ addressDown: true });
    const r = await lookupMiamiDadeProperty("200 S Biscayne Blvd", "33131", null);
    expect(r.error).toBeTruthy();
    expect(countyLookupMiss(r)).toBe(false);
    expect(await staleCountyUpdates(filledFrom10279("200 S Biscayne Blvd"), r)).toEqual({});
  });

  it("sin folio guardado o sin poder leer la parcela anterior → nada", async () => {
    const miss = { found: false, nonResidential: true };
    expect(await staleCountyUpdates({ ...filledFrom10279("x"), folio: null }, miss)).toEqual({});
    expect(await staleCountyUpdates(filledFrom10279("x"), miss, async () => null)).toEqual({});
  });

  it("staleCountyColumns: con unidad, el tipo vuelve a Condo (valor inicial)", () => {
    const previous = { property_type: "townhouse" } as MiamiDadeDetails;
    const out = staleCountyColumns({ ...filledFrom10279("500 Brickell Ave, Unit 3001") }, previous);
    expect(out.property_type).toBe("condo");
  });
});

describe("creación del acuerdo: la descripción legal de una parcela no residencial no se usa", () => {
  it("folio de 200 S Biscayne (oficinas) → null = 'pending'", async () => {
    stubCounty();
    expect(
      await verifiedLegalDescription({ address_street: "200 S Biscayne Blvd", address_zip: "33131", folio: folioOf(BISCAYNE_200) }),
    ).toBeNull();
  });
  it("folio de un edificio de 5+ unidades → null = 'pending'", async () => {
    stubCounty();
    expect(
      await verifiedLegalDescription({ address_street: "1500 NW 7th St", address_zip: "33125", folio: folioOf(MULTI_24) }),
    ).toBeNull();
  });
  it("vivienda con su folio → la descripción del condado", async () => {
    stubCounty();
    expect(
      await verifiedLegalDescription({ address_street: "10279 NW 30th Ter", address_zip: "33172", folio: folioOf(NW_30_TER_10279) }),
    ).toBe("BEACON AT DORAL\nPB 164-063\nLOT 8  BLK 8");
  });
  it("sin descripción verificada, el acuerdo queda 'pending'", () => {
    const tabs = readFileSync(join(process.cwd(), "src/lib/docusign/listing-agreement-tabs.ts"), "utf8");
    expect(tabs).toContain('legalStatus: input.verifiedLegal?.trim() ? "verified" : "pending"');
  });
});

describe("el paso 3 aplica la limpieza y el enlace", () => {
  const page = readFileSync(join(process.cwd(), "src/app/[lang]/listing/new/page.tsx"), "utf8");

  it("consulta automática (también con folio guardado) y botón borran lo que quedó", () => {
    expect(page).toMatch(/if \(isMiamiDade && \(isEmpty\(current\) \|\| current\.folio\)\)/);
    expect(page).toContain("const stale = await staleCountyUpdates(current, result);");
    expect(page).toContain("const stale = await staleCountyUpdates(row, result);");
    expect(page).toContain("staleCountyUpdates(current, { found: false })");
    expect(page).toContain(".update({ ...stale, ...update })");
  });

  it("las marcas 'Autofilled' dependen del folio (que se borra)", () => {
    expect(page).not.toMatch(/autofilled=\{(?!!!draft\?\.folio\})/);
  });

  it("'escríbenos' del aviso de 5+ unidades enlaza a /contact?topic=sell", () => {
    expect(page).toContain("`/${lang}/contact?topic=sell`");
    expect(dictionaries.es.listingForm.step3.autofillMultifamily5).toContain("[escríbenos]");
    expect(dictionaries.en.listingForm.step3.autofillMultifamily5).toContain("[write to us]");
  });
});

describe("ed8132ef: baños = 1 y el aviso de autollenado (2026-10-27)", () => {
  it("el condado no da baños para 200 S Biscayne (0 completos, 0 medios): el 1 no vino de él", async () => {
    stubCounty();
    const r = await lookupMiamiDadeProperty("10279 NW 30th Ter", "33172", null);
    expect(r.details?.bathrooms).toBe(2.5); // 2 completos + 1 medio
    expect((await countyParcelByFolio(folioOf(BISCAYNE_200)))?.bathrooms).toBeNull();
  });

  it("el 1 era el valor con que nacía todo borrador (paso 1), no un dato del condado; ahora nace en 0 (vacío)", () => {
    const page = readFileSync(join(process.cwd(), "src/app/[lang]/listing/new/page.tsx"), "utf8");
    expect(page).toMatch(/bedrooms: 0,\s*bathrooms: 0,\s*sqft: 0,/);
  });

  it("la comparación no depende del formato numérico (numeric de Postgres: 1 / 1.0 / \"2.5\")", () => {
    const previous = { bathrooms: 1, lot_size: 1495, tax_annual_amount: 9270 } as MiamiDadeDetails;
    const asText = { ...filledFrom10279("x"), bathrooms: "1.0", lot_size: "1495.00", tax_annual_amount: "9270" } as unknown as CountyFilledColumns;
    const out = staleCountyColumns(asText, previous);
    expect(out.bathrooms).toBe(0);
    expect(out.lot_size).toBeNull();
    expect(out.tax_annual_amount).toBeNull();
    expect(staleCountyColumns({ ...filledFrom10279("x"), bathrooms: 2.5 }, { bathrooms: 2.5 } as MiamiDadeDetails).bathrooms).toBe(0);
  });

  it("el aviso 'pre-filled from Miami-Dade' depende del folio, como las marcas 'Autofilled'", () => {
    const page = readFileSync(join(process.cwd(), "src/app/[lang]/listing/new/page.tsx"), "utf8");
    expect(page).toMatch(/\{draft\?\.folio && step3MiamiDade && \(\s*<SuccessBanner message=\{copy\.step3\.autoFilledNote\} \/>/);
    expect(page).not.toContain("draft.bedrooms > 0 && step3MiamiDade");
  });
});

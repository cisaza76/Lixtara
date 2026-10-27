import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { countyYearBuilt, mapDorToType, pickCountyCandidate, propertyTypeFromCounty, unitFromStoredStreet } from "@/lib/miami-dade";

describe("mapDorToType: código de uso del condado (4 dígitos: clase DOR + subcódigo)", () => {
  // Pares REALES de GetPropertySearchByFolio (2026-10-17): DORCode | DORDescription.
  const REAL: Array<[string, string, string | null]> = [
    ["0101", "RESIDENTIAL - SINGLE FAMILY : 1 UNIT", "single_family"],
    ["0104", "RESIDENTIAL - SINGLE FAMILY : RESIDENTIAL - TOTAL VALUE", "single_family"],
    ["0105", "RESIDENTIAL - SINGLE FAMILY : CLUSTER HOME", "single_family"],
    ["0176", "RESIDENTIAL - SINGLE FAMILY : RESIDENTIAL W/ ADDITIONAL QUARTERS", "single_family"],
    ["0407", "RESIDENTIAL - TOTAL VALUE : CONDOMINIUM - RESIDENTIAL", "condo"],
    ["0410", "RESIDENTIAL - TOTAL VALUE : TOWNHOUSE", "townhouse"],
    ["0508", "COOPERATIVE - RESIDENTIAL : COOPERATIVE - RESIDENTIAL", "condo"],
    ["0802", "MULTIFAMILY 2-9 UNITS : 2 LIVING UNITS", "multi_family"],
    ["0803", "MULTIFAMILY 2-9 UNITS : MULTIFAMILY 3 OR MORE UNITS", "multi_family"],
    ["0303", "MULTIFAMILY 10 UNITS PLUS : MULTIFAMILY 3 OR MORE UNITS", "multi_family"],
    ["0081", "VACANT RESIDENTIAL : VACANT LAND", null],
    ["0420", "RESIDENTIAL - TOTAL VALUE : DOCK - TOTAL VALUE", null],
  ];
  it.each(REAL)("%s %s → %s", (code, desc, want) => {
    expect(mapDorToType(code, desc)).toBe(want);
  });

  it("sin descripción, decide la clase (los dos primeros dígitos)", () => {
    expect(mapDorToType("0101")).toBe("single_family");
    expect(mapDorToType("0407")).toBe("condo");
    expect(mapDorToType("0508")).toBe("condo");
    expect(mapDorToType("0802")).toBe("multi_family");
    expect(mapDorToType("0303")).toBe("multi_family");
  });

  it("los códigos viejos mal leídos ya no se aceptan (0081 es terreno, no townhouse)", () => {
    expect(mapDorToType("0081")).toBeNull();
    expect(mapDorToType("0001")).toBeNull();
    expect(mapDorToType("0004")).toBeNull();
  });

  it("null para códigos desconocidos y entradas vacías", () => {
    expect(mapDorToType("9999")).toBeNull();
    expect(mapDorToType("")).toBeNull();
    expect(mapDorToType(null)).toBeNull();
    expect(mapDorToType(undefined)).toBeNull();
  });
});

describe("propertyTypeFromCounty: unidad sin código claro → Condo", () => {
  it("500 Brickell Ave #3001 (0407) es Condo, no casa unifamiliar", () => {
    expect(propertyTypeFromCounty("0407", "RESIDENTIAL - TOTAL VALUE : CONDOMINIUM - RESIDENTIAL", true)).toBe("condo");
  });
  it("con unidad y código no claro o ausente → condo", () => {
    expect(propertyTypeFromCounty("0420", "RESIDENTIAL - TOTAL VALUE : DOCK - TOTAL VALUE", true)).toBe("condo");
    expect(propertyTypeFromCounty(undefined, undefined, true)).toBe("condo");
  });
  it("sin unidad y código no claro → null (el vendedor elige)", () => {
    expect(propertyTypeFromCounty("9999", "", false)).toBeNull();
  });
  it("un código claro manda aunque haya unidad", () => {
    expect(propertyTypeFromCounty("0410", "RESIDENTIAL - TOTAL VALUE : TOWNHOUSE", true)).toBe("townhouse");
    expect(propertyTypeFromCounty("0802", "MULTIFAMILY 2-9 UNITS : 2 LIVING UNITS", true)).toBe("multi_family");
  });
  it("el borrador nuevo con unidad nace como Condo", () => {
    const wizard = readFileSync(join(resolve(__dirname, "../.."), "src/app/[lang]/listing/new/page.tsx"), "utf8");
    expect(wizard).toContain('property_type: unitFromStoredStreet(street) ? "condo" : "single_family"');
  });
});

describe("condado: qué parcela y qué año se aceptan (regla 2026-10-16)", () => {
  // Candidatos REALES de GetAddress (2026-10-16), solo dirección y unidad.
  const biscayne = [{ Strap: "01-0110-020-2010", SiteAddress: "130 BISCAYNE BLVD", SiteUnit: "" }];
  const brickell = [
    { Strap: "01-0210-030-1500", SiteAddress: "35 SE 6 ST", SiteUnit: "" },
    { Strap: "01-4138-144-0010", SiteAddress: "500 BRICKELL AVE", SiteUnit: "300" },
    { Strap: "01-4138-144-0020", SiteAddress: "500 BRICKELL AVE", SiteUnit: "400" },
  ];

  it("100 Biscayne Blvd: el condado devuelve 130 Biscayne (otra parcela) → ninguna", () => {
    expect(pickCountyCandidate(biscayne, "100 Biscayne Blvd")).toBeNull();
  });
  it("500 Brickell Ave sin unidad: varias unidades → ninguna (antes tomaba el área común)", () => {
    expect(pickCountyCandidate(brickell, "500 Brickell Ave")).toBeNull();
  });
  it("500 Brickell Ave con unidad: esa unidad", () => {
    expect(pickCountyCandidate(brickell, "500 Brickell Ave", "400")).toBe("0141381440020");
    expect(pickCountyCandidate(brickell, "500 Brickell Ave", "#0300")).toBe("0141381440010");
    expect(pickCountyCandidate(brickell, "500 Brickell Ave", "999")).toBeNull();
  });
  it("una casa: número y calle iguales, con ordinales y direccionales normalizados", () => {
    const house = [{ Strap: "01-0210-030-1500", SiteAddress: "35 SE 6 ST", SiteUnit: "" }];
    expect(pickCountyCandidate(house, "35 SE 6th St")).toBe("0102100301500");
    expect(pickCountyCandidate(house, "36 SE 6th St")).toBeNull();
  });
  it("direccional escrita completa (Google Places): 'Northwest' = 'NW' (auditoría #04)", () => {
    // Candidato REAL de GetAddress (2026-10-26) para la dirección de la auditoría del CMO.
    const doral = [{ Strap: "35-3029-114-0580", SiteAddress: "10279 NW 30 TER", SiteUnit: "" }];
    expect(pickCountyCandidate(doral, "10279 Northwest 30th Terrace")).toBe("3530291140580");
    expect(pickCountyCandidate(doral, "10279 NW 30th Ter")).toBe("3530291140580");
    expect(pickCountyCandidate(doral, "10279 Northwest 31st Terrace")).toBeNull();
    const se = [{ Strap: "01-0210-030-1500", SiteAddress: "35 SE 6 ST", SiteUnit: "" }];
    expect(pickCountyCandidate(se, "35 Southeast 6th Street")).toBe("0102100301500");
  });

  it("año: 'Multiple (See Building Info.)' o '0' → el año real más antiguo de los edificios", () => {
    expect(countyYearBuilt("Multiple (See Building Info.)", [{ Actual: 1975 }, { Actual: 1963 }], 2026)).toBe(1963);
    expect(countyYearBuilt("0", [], 2026)).toBeNull();
    expect(countyYearBuilt("1998", [{ Actual: 1963 }], 2026)).toBe(1998);
  });
  it("año: igual o mayor al actual, o anterior a 1800, no se acepta", () => {
    expect(countyYearBuilt("2026", [], 2026)).toBeNull();
    expect(countyYearBuilt("2027", [{ Actual: 2026 }], 2026)).toBeNull();
    expect(countyYearBuilt("1700", [], 2026)).toBeNull();
    expect(countyYearBuilt("2025", [], 2026)).toBe(2025);
  });
});

describe("unidad guardada en el paso 1", () => {
  it("sale de '<calle>, Unit <unidad>' y variantes", () => {
    expect(unitFromStoredStreet("500 Brickell Ave, Unit 3001")).toBe("3001");
    expect(unitFromStoredStreet("500 Brickell Ave Apt 4B")).toBe("4B");
    expect(unitFromStoredStreet("500 Brickell Ave #12")).toBe("12");
    expect(unitFromStoredStreet("100 Biscayne Blvd")).toBeNull();
  });
});

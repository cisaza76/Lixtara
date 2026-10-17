import { describe, it, expect } from "vitest";
import { countyYearBuilt, mapDorToType, pickCountyCandidate, unitFromStoredStreet } from "@/lib/miami-dade";

describe("mapDorToType", () => {
  it("maps county DOR use codes to our property_type enum", () => {
    expect(mapDorToType("0001")).toBe("single_family");
    expect(mapDorToType("0004")).toBe("condo");
    expect(mapDorToType("0005")).toBe("condo");
    expect(mapDorToType("0081")).toBe("townhouse");
    expect(mapDorToType("0003")).toBe("multi_family");
    expect(mapDorToType("0008")).toBe("multi_family");
  });

  it("matches on the code prefix (full DOR strings carry a description suffix)", () => {
    expect(mapDorToType("0001 RESIDENTIAL - SINGLE FAMILY")).toBe("single_family");
    expect(mapDorToType("  0004 CONDOMINIUM")).toBe("condo");
  });

  it("returns null for unknown codes and empty/nullish input", () => {
    expect(mapDorToType("9999")).toBeNull();
    expect(mapDorToType("")).toBeNull();
    expect(mapDorToType(null)).toBeNull();
    expect(mapDorToType(undefined)).toBeNull();
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

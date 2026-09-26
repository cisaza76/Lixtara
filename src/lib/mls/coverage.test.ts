import { describe, it, expect } from "vitest";
import {
  SUPPORTED_COUNTIES, SUPPORTED_STATE, SUPPORTED_PROPERTY_TYPES,
  COUNTY_FIELD_CANDIDATES, STATE_FIELD_CANDIDATES,
  normalizeGeoName, coverageVerdict, isWithinCoverage, partitionByCoverage,
} from "./coverage";
import { makeResoListing } from "./feed-port.fake";
import type { ResoListing } from "./feed-port";

const conGeo = (county?: unknown, state: unknown = "FL", extra: Record<string, unknown> = {}) =>
  makeResoListing({
    ListingKey: "K1",
    ...(county !== undefined ? { CountyOrParish: county } : {}),
    StateOrProvince: state,
    ...extra,
  } as Parameters<typeof makeResoListing>[0]);

describe("la decisión de cobertura está clavada", () => {
  it("son exactamente los tres condados que decidió el owner", () => {
    // Si alguien añade o quita un condado sin querer, este test lo detiene.
    // Naples (Collier) y Tampa (Hillsborough) NO entran: corren bajo Southwest
    // Florida MLS y Stellar MLS, que son feeds distintos a este.
    expect([...SUPPORTED_COUNTIES]).toEqual(["Miami-Dade", "Broward", "Palm Beach"]);
    expect(SUPPORTED_STATE).toBe("FL");
  });

  it("los candidatos de campo incluyen el estándar RESO", () => {
    expect(COUNTY_FIELD_CANDIDATES).toContain("CountyOrParish");
    expect(STATE_FIELD_CANDIDATES).toContain("StateOrProvince");
  });
});

describe("normalizeGeoName", () => {
  it("iguala las variantes con que cada MLS teclea el mismo condado", () => {
    // Una comparación literal dejaría fuera listings legítimos según cómo lo teclee
    // cada MLS. Todas estas tienen que caer en el mismo valor.
    const canon = normalizeGeoName("Miami-Dade");
    expect(canon).not.toBeNull();
    for (const v of ["MIAMI-DADE", "Miami Dade", "miami_dade",
                     "Miami-Dade County", "  Miami-Dade  "]) {
      expect(normalizeGeoName(v), v).toBe(canon);
    }
  });

  it("quita el sufijo County", () => {
    expect(normalizeGeoName("Broward County")).toBe("broward");
    expect(normalizeGeoName("Palm Beach County")).toBe("palm beach");
  });

  it("no se vacía al quitar el sufijo: un valor degenerado ≠ campo ausente", () => {
    // Encontrado corriendo contra el feed real: el dataset `test` de Bridge trae
    // CountyOrParish: "County" como relleno. Quitar el sufijo a ciegas lo dejaba vacío,
    // el campo parecía AUSENTE y el filtro excluía todo por county_field_missing.
    expect(normalizeGeoName("County")).toBe("county");
    expect(normalizeGeoName("COUNTY")).toBe("county");
    // Y sigue quitándolo cuando queda algo:
    expect(normalizeGeoName("Broward County")).toBe("broward");
  });

  it("devuelve null ante lo que no es un nombre", () => {
    for (const v of [null, undefined, "", "   ", 42, {}, []]) {
      expect(normalizeGeoName(v)).toBeNull();
    }
  });
});

describe("coverageVerdict", () => {
  it("incluye los tres condados, escritos como sea", () => {
    for (const c of ["Miami-Dade", "Broward County", "palm beach", "MIAMI DADE"]) {
      const v = coverageVerdict(conGeo(c));
      expect(v.included, c).toBe(true);
    }
  });

  it("reporta qué campo usó — para poder auditarlo", () => {
    const v = coverageVerdict(conGeo("Broward"));
    expect(v).toMatchObject({ included: true, county: "broward", countyField: "CountyOrParish" });
  });

  it("usa el candidato alternativo si el primero no está", () => {
    const l = makeResoListing({ ListingKey: "K", County: "Broward", StateOrProvince: "FL" } as never);
    const v = coverageVerdict(l as ResoListing);
    expect(v).toMatchObject({ included: true, countyField: "County" });
  });

  it("excluye condados de Florida fuera del alcance", () => {
    // Collier = Naples, Hillsborough = Tampa. Son feeds DISTINTOS, no un filtro.
    for (const c of ["Collier", "Hillsborough", "Orange", "Monroe"]) {
      expect(coverageVerdict(conGeo(c))).toMatchObject({
        included: false, reason: "county_not_supported",
      });
    }
  });

  it("excluye fuera de Florida antes de mirar el condado", () => {
    expect(coverageVerdict(conGeo("Broward", "NY"))).toMatchObject({
      included: false, reason: "state_not_supported",
    });
  });

  it("acepta el estado escrito como FL o Florida", () => {
    expect(isWithinCoverage(conGeo("Broward", "FL"))).toBe(true);
    expect(isWithinCoverage(conGeo("Broward", "Florida"))).toBe(true);
  });

  it("FAIL-CLOSED: sin condado determinable, excluye", () => {
    // Es el default seguro y el fallo ruidoso: si el nombre del campo fuera otro,
    // TODO se excluye y la búsqueda queda vacía — se nota de inmediato. Incluir ante
    // la duda metería inventario fuera de alcance en silencio.
    const sinCondado = makeResoListing({ ListingKey: "K", StateOrProvince: "FL" });
    expect(coverageVerdict(sinCondado)).toMatchObject({
      included: false, reason: "county_field_missing",
    });
  });

  it("el estado ausente no bloquea: el condado es el criterio", () => {
    const l = makeResoListing({ ListingKey: "K", CountyOrParish: "Broward" } as never);
    expect(isWithinCoverage(l as ResoListing)).toBe(true);
  });
});

describe("partitionByCoverage", () => {
  it("separa y cuenta por motivo", () => {
    const r = partitionByCoverage([
      conGeo("Miami-Dade"), conGeo("Broward"), conGeo("Collier"),
      conGeo("Broward", "NY"), makeResoListing({ ListingKey: "X", StateOrProvince: "FL" }),
    ]);
    expect(r.included).toHaveLength(2);
    expect(r.excluded).toHaveLength(3);
    expect(r.counts).toEqual({
      included: 2, county_not_supported: 1, state_not_supported: 1, county_field_missing: 1,
      property_type_missing: 0, property_type_not_supported: 0,
    });
  });

  it("el conteo de county_field_missing es la señal de que el campo está mal", () => {
    // Si domina, el nombre del campo no es el que asumimos y hay que correr
    // scripts/inspect-bridge-fields.ts contra el feed real.
    const todosSinCampo = ["A","B","C"].map((k) =>
      makeResoListing({ ListingKey: k, StateOrProvince: "FL" }));
    const r = partitionByCoverage(todosSinCampo);
    expect(r.counts.county_field_missing).toBe(3);
    expect(r.counts.included).toBe(0);
  });
});

describe("filtro de tipo de propiedad (decisión del owner 2026-09-18)", () => {
  const conTipo = (t: unknown) =>
    makeResoListing({ ListingKey: "K", CountyOrParish: "Broward", StateOrProvince: "FL",
                      PropertyType: t } as never);

  it("solo entra venta residencial", () => {
    expect([...SUPPORTED_PROPERTY_TYPES]).toEqual(["Residential"]);
  });

  it("acepta Residential", () => {
    expect(coverageVerdict(conTipo("Residential"))).toMatchObject({
      included: true, propertyType: "Residential",
    });
  });

  it("IGUALDAD EXACTA: rechaza los tipos que comparten prefijo", () => {
    // El fallo que un startsWith habría causado: "Residential Lease" es el 26,2 % del
    // feed con mediana $3.500 — un cuarto del inventario en alquiler dentro de una
    // búsqueda de compra.
    for (const t of ["Residential Lease", "Residential Income"]) {
      expect(coverageVerdict(conTipo(t)), t).toMatchObject({
        included: false, reason: "property_type_not_supported", detail: t,
      });
    }
  });

  it("rechaza terrenos, comercial y oportunidades de negocio", () => {
    for (const t of ["Land/Boat Docks", "Commercial Sale", "Commercial Land",
                     "Business Opportunity"]) {
      expect(coverageVerdict(conTipo(t)).included, t).toBe(false);
    }
  });

  it("los siete tipos reales del feed: solo uno entra", () => {
    // Enumeración medida contra miamire el 2026-09-18.
    const delFeed = ["Residential", "Residential Lease", "Land/Boat Docks", "Commercial Sale",
                     "Commercial Land", "Business Opportunity", "Residential Income"];
    const entran = delFeed.filter((t) => coverageVerdict(conTipo(t)).included);
    expect(entran).toEqual(["Residential"]);
  });

  it("FAIL-CLOSED sin tipo", () => {
    for (const t of [undefined, null, "", "   ", 42]) {
      const v = coverageVerdict(conTipo(t));
      expect(v.included, String(t)).toBe(false);
    }
    expect(coverageVerdict(conTipo(undefined))).toMatchObject({ reason: "property_type_missing" });
  });

  it("no normaliza el tipo: es enumeración cerrada del MLS, no texto tecleado", () => {
    // Normalizar aquí crearía falsos positivos entre "Residential" y sus variantes.
    expect(coverageVerdict(conTipo("residential")).included).toBe(false);
    expect(coverageVerdict(conTipo("RESIDENTIAL")).included).toBe(false);
  });

  it("la geografía se evalúa ANTES que el tipo", () => {
    const fuera = makeResoListing({ ListingKey: "K", CountyOrParish: "Collier",
                                    StateOrProvince: "FL", PropertyType: "Residential Lease" } as never);
    expect(coverageVerdict(fuera)).toMatchObject({ reason: "county_not_supported" });
  });
});

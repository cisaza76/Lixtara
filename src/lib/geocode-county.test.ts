import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { countyForAddress, isMiamiDadeCounty } from "./geocode";

// Respuestas de Google Geocoding recortadas a lo que se usa (address_components).
function google(city: string, county: string, zip: string) {
  return {
    status: "OK",
    results: [
      {
        address_components: [
          { long_name: city, types: ["locality", "political"] },
          { long_name: county, types: ["administrative_area_level_2", "political"] },
          { long_name: "Florida", types: ["administrative_area_level_1", "political"] },
          { long_name: zip, types: ["postal_code"] },
        ],
      },
    ],
  };
}
function mockGoogle(payload: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => payload })));
}

describe("paso 3: la consulta de Miami-Dade depende del condado de Google, no del ZIP (#04)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["10279 Northwest 30th Terrace", "Doral", "33172", "Miami-Dade County", true],
    ["100 N Andrews Ave", "Fort Lauderdale", "33301", "Broward County", false],
    ["201 W Palmetto Park Rd", "Boca Raton", "33432", "Palm Beach County", false],
  ])("%s, %s FL %s → %s (Miami-Dade: %s)", async (street, city, zip, county, md) => {
    vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "k");
    mockGoogle(google(city, county, zip));
    const got = await countyForAddress(street, city, "FL", zip);
    expect(got).toBe(county);
    expect(isMiamiDadeCounty(got)).toBe(md);
  });

  it("los tres ZIP empiezan por 33: el ZIP no distingue el condado", () => {
    expect(["33172", "33301", "33432"].every((z) => z.startsWith("33"))).toBe(true);
  });

  it("sin clave, error HTTP, status no-OK o sin condado → null (no se ofrece la consulta)", async () => {
    vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
    expect(await countyForAddress("1 Main St", "Doral", "FL", "33172")).toBeNull();
    vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "k");
    mockGoogle({}, false);
    expect(await countyForAddress("1 Main St", "Doral", "FL", "33172")).toBeNull();
    mockGoogle({ status: "OVER_QUERY_LIMIT" });
    expect(await countyForAddress("1 Main St", "Doral", "FL", "33172")).toBeNull();
    mockGoogle({ status: "OK", results: [{ address_components: [] }] });
    expect(await countyForAddress("1 Main St", "Doral", "FL", "33172")).toBeNull();
  });

  it("variantes de escritura de Miami-Dade", () => {
    for (const c of ["Miami-Dade County", "Miami Dade County", "miami-dade"]) expect(isMiamiDadeCounty(c), c).toBe(true);
    for (const c of ["Broward County", "Palm Beach County", "Monroe County", "", null]) expect(isMiamiDadeCounty(c)).toBe(false);
  });

  it("el paso 3 ya no decide por el ZIP", () => {
    const page = readFileSync(join(resolve(__dirname, "../.."), "src/app/[lang]/listing/new/page.tsx"), "utf8");
    expect(page).not.toMatch(/\^33\\d\{3\}/);
    expect(page).toContain("isMiamiDadeCounty(step3County)");
    expect(page).toContain("copy.step3.autofillOutsideCounty");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRentcastEstimate } from "./rentcast";
import { t } from "./i18n";

const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
const okBody = {
  price: 873000,
  priceRangeLow: 647000,
  priceRangeHigh: 1098000,
  comparables: [
    { formattedAddress: "A", bedrooms: 3, bathrooms: 2, squareFootage: 1800, yearBuilt: 2006, price: 795000, status: "Inactive", listedDate: null, removedDate: recent, lastSeenDate: null, daysOnMarket: 30, distance: 0.3 },
    { formattedAddress: "B", bedrooms: 3, bathrooms: 2, squareFootage: 1700, yearBuilt: 2005, price: 639900, status: "Active", listedDate: null, removedDate: null, lastSeenDate: null, daysOnMarket: 5, distance: 0.02 },
    { formattedAddress: "far", bedrooms: 3, bathrooms: 2, squareFootage: 1700, yearBuilt: 2005, price: 1, status: "Active", listedDate: null, removedDate: null, lastSeenDate: null, daysOnMarket: 5, distance: 2 },
  ],
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
const call = () => fetchRentcastEstimate("10279 NW 30th Ter", "Doral", "FL", "33172");

describe("Rentcast: falla ≠ sin comparables (auditoría #05)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.spyOn(console, "error").mockRestore();
  });

  it("sin clave → error (no se guarda como 'sin comparables')", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await call()).toEqual({ status: "error" });
  });

  it("HTTP 429/500 o red caída → error", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "k");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(429, { message: "rate limited" });
    expect((await call()).status).toBe("error");
    mockFetch(500, {});
    expect((await call()).status).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await call()).status).toBe("error");
  });

  it("404 o respuesta sin precio → no_data", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "k");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(404, { message: "not found" });
    expect(await call()).toEqual({ status: "no_data" });
    mockFetch(200, { comparables: [] });
    expect(await call()).toEqual({ status: "no_data" });
  });

  it("ok → vendidas recientes primero, activas para completar, nada a más de 1 milla", async () => {
    vi.stubEnv("RENTCAST_API_KEY", "k");
    mockFetch(200, okBody);
    const r = await call();
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.estimate.priceLow).toBe(647000);
    expect(r.estimate.comps.map((c) => c.formattedAddress)).toEqual(["A", "B"]);
  });

  it("el aviso de 'sin comparables' no nombra al proveedor y ofrece una salida", () => {
    for (const lang of ["en", "es"] as const) {
      const s = t(lang).listingForm.step3;
      expect(s.compsEmpty).not.toMatch(/rentcast/i);
      expect(s.compsEmptyCta.length).toBeGreaterThan(0);
    }
  });
});

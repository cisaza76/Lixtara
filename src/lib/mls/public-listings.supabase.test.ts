import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// D · Con la sincronización encendida y la exhibición apagada, /properties no puede
// mostrar NADA del MLS. Se prueba el lector que usa la página, no solo el gate: lo que
// importa es que la base de datos ni siquiera se consulte.
const hostActual = { value: "lixtara.com" };
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", hostActual.value]]),
}));

const filas = [{
  listing_key: "K1", listing_id: "A11111111", mls_status: "Active", withdrawn_at: null,
  list_price: 500000, city: "Miami", postal_code: "33130",
  list_office_name: "Some Firm", list_agent_name: "Jane", list_office_phone: null,
  list_office_email: null, list_agent_phone: null, list_agent_email: null,
}];
const llamadas: Array<[string, unknown[]]> = [];
const createService = vi.fn(() => {
  const anota = (m: string) => (...args: unknown[]) => { llamadas.push([m, args]); return q; };
  const q: Record<string, unknown> = {
    select: anota("select"), is: anota("is"), in: anota("in"), order: anota("order"),
    gte: anota("gte"), lte: anota("lte"), eq: anota("eq"),
    range: async (...args: unknown[]) => {
      llamadas.push(["range", args]);
      return { data: filas, error: null, count: 137 };
    },
  };
  return { from: () => q };
});
vi.mock("@/lib/supabase/service", () => ({ createService: () => createService() }));

import { getPublicMlsListings } from "./public-listings.supabase";
import { parsePropertySearch } from "@/lib/property-search";

const env = { ...process.env };
beforeEach(() => {
  createService.mockClear();
  llamadas.length = 0;
  hostActual.value = "lixtara.com";
  for (const k of ["MLS_FEED_ENABLED", "MLS_SYNC_ENABLED", "MLS_DISPLAY_ENABLED"]) delete process.env[k];
  process.env.VERCEL_ENV = "production";
});
afterEach(() => { process.env = { ...env }; });

describe("lector público del MLS según los interruptores", () => {
  it("sync encendida + display apagada → vacío y sin tocar la base", async () => {
    process.env.MLS_SYNC_ENABLED = "true";
    const r = await getPublicMlsListings([], "en");
    expect(r).toEqual({ listings: [], enabled: false, total: 0 });
    expect(createService).not.toHaveBeenCalled();
  });

  it("sync encendida + display \"false\" explícito, con el flag viejo puesto → vacío", async () => {
    process.env.MLS_FEED_ENABLED = "true";
    process.env.MLS_SYNC_ENABLED = "true";
    process.env.MLS_DISPLAY_ENABLED = "false";
    const r = await getPublicMlsListings([], "en");
    expect(r.listings).toEqual([]);
    expect(r.enabled).toBe(false);
    expect(createService).not.toHaveBeenCalled();
  });

  it("display encendida sobre el host licenciado → muestra", async () => {
    process.env.MLS_DISPLAY_ENABLED = "true";
    const r = await getPublicMlsListings([], "en");
    expect(r.enabled).toBe(true);
    expect(r.listings.map((l) => l.listingKey)).toEqual(["K1"]);
  });

  it("display encendida en el alias de Vercel → vacío", async () => {
    process.env.MLS_DISPLAY_ENABLED = "true";
    hostActual.value = "lixtara.vercel.app";
    expect((await getPublicMlsListings([], "en")).listings).toEqual([]);
    expect(createService).not.toHaveBeenCalled();
  });

  it("solo el flag viejo → se comporta como antes (muestra)", async () => {
    process.env.MLS_FEED_ENABLED = "true";
    expect((await getPublicMlsListings([], "en")).listings).toHaveLength(1);
  });
});

describe("filtros y paginación del lector público", () => {
  beforeEach(() => { process.env.MLS_DISPLAY_ENABLED = "true"; });

  it("aplica cada filtro sobre su columna indexada, nunca sobre payload", async () => {
    const search = parsePropertySearch({
      min_price: "300000", max_price: "750000", beds: "3", baths: "2",
      county: "broward", zip: "33301", sort: "price_asc", page: "3",
    });
    const r = await getPublicMlsListings([], "en", search);
    expect(r.total).toBe(137);
    expect(llamadas).toEqual(expect.arrayContaining([
      ["gte", ["list_price", 300000]],
      ["lte", ["list_price", 750000]],
      ["gte", ["bedrooms", 3]],
      ["gte", ["bathrooms", 2]],
      ["eq", ["county_key", "broward"]],
      ["eq", ["postal_code", "33301"]],
      ["order", ["list_price", { ascending: true, nullsFirst: false }]],
      ["range", [48, 71]],
    ]));
    expect(JSON.stringify(llamadas.filter(([m]) => m !== "select"))).not.toContain("payload");
  });

  it("sin filtros: más recientes primero, primera página", async () => {
    await getPublicMlsListings([], "en");
    expect(llamadas).toEqual(expect.arrayContaining([
      ["order", ["modification_ts", { ascending: false }]],
      ["range", [0, 23]],
    ]));
    expect(llamadas.some(([m]) => m === "gte" || m === "lte" || m === "eq")).toBe(false);
  });
});

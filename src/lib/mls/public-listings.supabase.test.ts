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
const createService = vi.fn(() => {
  const q = {
    select: () => q, is: () => q, in: () => q, order: () => q,
    limit: async () => ({ data: filas, error: null }),
  };
  return { from: () => q };
});
vi.mock("@/lib/supabase/service", () => ({ createService: () => createService() }));

import { getPublicMlsListings } from "./public-listings.supabase";

const env = { ...process.env };
beforeEach(() => {
  createService.mockClear();
  hostActual.value = "lixtara.com";
  for (const k of ["MLS_FEED_ENABLED", "MLS_SYNC_ENABLED", "MLS_DISPLAY_ENABLED"]) delete process.env[k];
  process.env.VERCEL_ENV = "production";
});
afterEach(() => { process.env = { ...env }; });

describe("lector público del MLS según los interruptores", () => {
  it("sync encendida + display apagada → vacío y sin tocar la base", async () => {
    process.env.MLS_SYNC_ENABLED = "true";
    const r = await getPublicMlsListings([], "en");
    expect(r).toEqual({ listings: [], enabled: false });
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

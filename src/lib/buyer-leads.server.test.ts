import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/admin-auth", () => ({ isStaff: async () => false }));

import { ensureBrokerOfRecord, resolveTarget, showingRequestsPublic } from "./buyer-leads.server";

/** Cliente falso: registra la tabla y los filtros; devuelve `result` por tabla. */
function fakeSvc(results: Record<string, unknown>, inserts: unknown[] = []) {
  const calls: Array<[string, string, unknown[]]> = [];
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = (m: string) => (...args: unknown[]) => { calls.push([table, m, args]); return q; };
    for (const m of ["select", "eq", "is", "in"]) q[m] = chain(m);
    q.maybeSingle = async () => ({ data: results[table] ?? null });
    q.insert = (row: unknown) => { inserts.push(row); return { select: () => ({ single: async () => ({ data: { id: "new-broker" } }) }) }; };
    return q;
  };
  return { svc: { from: builder } as never, calls, inserts };
}

const env = { ...process.env };
beforeEach(() => {
  process.env = { ...env };
  for (const k of ["MLS_FEED_ENABLED", "MLS_SYNC_ENABLED", "MLS_DISPLAY_ENABLED"]) delete process.env[k];
});

describe("interruptor público", () => {
  it("solo el literal \"true\" lo abre", () => {
    expect(showingRequestsPublic({})).toBe(false);
    for (const v of ["1", "TRUE", "yes", ""]) {
      expect(showingRequestsPublic({ BUYER_SHOWING_REQUESTS_ENABLED: v })).toBe(false);
    }
    expect(showingRequestsPublic({ BUYER_SHOWING_REQUESTS_ENABLED: "true" })).toBe(true);
  });
});

describe("resolveTarget", () => {
  it("ficha MLS con la exhibición apagada: rechazada al público, aceptada al staff", async () => {
    process.env.VERCEL_ENV = "production";
    const { svc } = fakeSvc({ mls_listings: { listing_key: "K1", listing_id: "A111" } });
    expect(await resolveTarget(svc, { kind: "mls", listingKey: "K1" }, { host: "lixtara.com", staff: false }))
      .toBeNull();
    expect(await resolveTarget(svc, { kind: "mls", listingKey: "K1" }, { host: "lixtara.com", staff: true }))
      .toEqual({ label: "MLS #A111", ownAddress: null });
  });

  it("ficha MLS: solo estados mostrables y no retiradas", async () => {
    const { svc, calls } = fakeSvc({ mls_listings: { listing_key: "K1", listing_id: "A111" } });
    await resolveTarget(svc, { kind: "mls", listingKey: "K1" }, { host: "lixtara.com", staff: true });
    expect(calls).toEqual(expect.arrayContaining([
      ["mls_listings", "is", ["withdrawn_at", null]],
      ["mls_listings", "in", ["mls_status", ["Active", "Active Under Contract", "Pending", "Coming Soon"]]],
    ]));
  });

  it("listing propio: solo activo y que no sea de prueba", async () => {
    const { svc, calls } = fakeSvc({
      properties: { address_street: "1 Main St", address_city: "Miami", address_zip: "33130" },
    });
    const r = await resolveTarget(svc, { kind: "own", propertyId: "p1" }, { host: null, staff: false });
    expect(r).toEqual({ label: "1 Main St, Miami 33130", ownAddress: "1 Main St, Miami 33130" });
    expect(calls).toEqual(expect.arrayContaining([
      ["properties", "eq", ["mls_status", "active"]],
      ["properties", "eq", ["is_test", false]],
    ]));
  });
});

describe("ensureBrokerOfRecord", () => {
  it("reutiliza la fila existente", async () => {
    const { svc, inserts } = fakeSvc({ agent_partners: { id: "b1" } });
    expect(await ensureBrokerOfRecord(svc)).toBe("b1");
    expect(inserts).toEqual([]);
  });

  it("la crea desde la configuración de la brokerage", async () => {
    const { svc, inserts } = fakeSvc({});
    expect(await ensureBrokerOfRecord(svc)).toBe("new-broker");
    expect(inserts[0]).toMatchObject({
      name: "Anamaria Velasquez",
      license_number: "BK3664191",
      brokerage_license: "CQ1075352",
      relationship: "broker_of_record",
      status: "active",
    });
  });
});

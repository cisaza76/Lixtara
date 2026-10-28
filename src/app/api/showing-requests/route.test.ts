import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  allowed: false,
  staff: false,
  limited: false,
  target: { label: "MLS #A111", ownAddress: null } as { label: string; ownAddress: string | null } | null,
  leadStatus: "received",
  mlsEnabled: false,
};
const insertShowingLead = vi.fn(async () => ({
  id: "lead-1", status: state.leadStatus, createdAt: "2026-10-11T14:00:00.000Z",
}));
const sendBroker = vi.fn(async () => ({ ok: true }));
const sendBuyer = vi.fn(async () => ({ ok: true }));
const recordNbr = vi.fn(async (...a: unknown[]) => (a.length >= 0 ? "nbr-1" : null));

vi.mock("@/lib/buyer-leads.server", () => ({
  canUseShowingRequests: async () => ({ allowed: state.allowed, staff: state.staff }),
  mlsShowingRequestsEnabled: () => state.mlsEnabled,
  resolveTarget: async () => state.target,
  ensureBrokerOfRecord: async () => "broker-1",
  insertShowingLead: (...a: unknown[]) => insertShowingLead(...(a as [])),
}));
vi.mock("@/lib/supabase/service", () => ({ createService: () => ({}) }));
vi.mock("@/lib/nbr-notice.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/nbr-notice.server")>()),
  recordInlineAcceptance: (...a: unknown[]) => recordNbr(...a),
}));
vi.mock("@/lib/email", () => ({
  sendBrokerShowingRequest: (...a: unknown[]) => sendBroker(...(a as [])),
  sendShowingRequestReceived: (...a: unknown[]) => sendBuyer(...(a as [])),
}));
vi.mock("@/lib/ratelimit", () => ({
  apiLimiter: () => null,
  clientIp: () => "1.2.3.4",
  enforceLimit: async () =>
    state.limited ? Response.json({ error: "rate_limited" }, { status: 429 }) : null,
}));

import { POST } from "./route";

const OWN = "8a4f6d2e-1b3c-4d5e-8f90-112233445566";
const AGENT = { buyer_agent_name: "Ana Agente", buyer_agent_brokerage: "Acme Realty", buyer_agent_email: "ana@example.com", buyer_agent_license: "SL123456" };
const valid = {
  property_id: OWN,
  full_name: "Jane Buyer",
  email: "jane@example.com",
  other_agent_status: "none",
  consent_contact: true,
  esign_consent: true,
  nbr_accept: true,
  lang: "en",
};
const post = (body: unknown) =>
  POST(new Request("https://lixtara.com/api/showing-requests", {
    method: "POST",
    headers: { "content-type": "application/json", host: "lixtara.com" },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  Object.assign(state, {
    allowed: true, staff: false, limited: false,
    target: { label: "123 TEST Street, Miami 33131", ownAddress: "123 TEST Street, Miami 33131" }, leadStatus: "received",
    mlsEnabled: false,
  });
  insertShowingLead.mockClear();
  sendBroker.mockClear();
  sendBuyer.mockClear();
  recordNbr.mockClear();
});

describe("POST /api/showing-requests", () => {
  it("interruptor cerrado y sin staff → 404 sin crear nada", async () => {
    state.allowed = false;
    const res = await post(valid);
    expect(res.status).toBe(404);
    expect(insertShowingLead).not.toHaveBeenCalled();
  });

  it("solicitud válida → crea el lead y envía ambos emails, sin confirmar la visita", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, exclusive: false, withAgent: false });
    expect(insertShowingLead).toHaveBeenCalledTimes(1);
    expect(sendBroker).toHaveBeenCalledTimes(1);
    expect(sendBuyer).toHaveBeenCalledWith(expect.objectContaining({ ownAddress: "123 TEST Street, Miami 33131", withAgent: false }));
    // Sin plazo prometido al comprador: el SLA no está confirmado con la broker.
    expect((sendBuyer.mock.calls as unknown[][])[0][0]).not.toHaveProperty("responseHours");
    expect(sendBroker).toHaveBeenCalledWith(expect.objectContaining({
      consentMarketing: false, consentVersion: "2026-10-draft-2",
      // Meta interna: 24 h después de creado el lead.
      respondBy: "2026-10-12T14:00:00.000Z",
      adminUrl: expect.stringContaining("?lead=lead-1"),
    }));
  });

  it("acuerdo exclusivo en un listado de Lixtara: NO se cancela; se coordina con el agente, sin aviso NBR", async () => {
    const res = await post({ ...valid, other_agent_status: "exclusive", esign_consent: false, nbr_accept: false, ...AGENT });
    expect(await res.json()).toEqual({ ok: true, exclusive: false, withAgent: true });
    expect(recordNbr).not.toHaveBeenCalled();
    expect(sendBroker).toHaveBeenCalledWith(expect.objectContaining({
      buyerAgent: expect.stringContaining("Ana Agente · Acme Realty · ana@example.com · FL license SL123456"),
      nbrNotice: null,
    }));
    expect(sendBuyer).toHaveBeenCalledWith(expect.objectContaining({ withAgent: true }));
  });

  it("fichas de otros brokers: apagadas para el lanzamiento (también para el staff)", async () => {
    state.staff = true;
    const res = await post({ ...valid, property_id: undefined, listing_key: "K1" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "target" });
    expect(insertShowingLead).not.toHaveBeenCalled();
    state.mlsEnabled = true;
    expect((await post({ ...valid, property_id: undefined, listing_key: "K1" })).status).toBe(200);
  });

  it("sin agente: guarda el aviso NBR aceptado con IP y user agent, ligado al lead", async () => {
    const res = await POST(new Request("https://lixtara.com/api/showing-requests", {
      method: "POST",
      headers: { "content-type": "application/json", host: "lixtara.com", "x-forwarded-for": "203.0.113.7", "user-agent": "TEST UA" },
      body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(200);
    expect(recordNbr).toHaveBeenCalledWith({}, { leadId: "lead-1" }, expect.objectContaining({
      fullName: "Jane Buyer", email: "jane@example.com", listingLabel: "123 TEST Street, Miami 33131", propertyId: OWN,
      ip: "203.0.113.7", userAgent: "TEST UA", lang: "en",
    }));
    expect(sendBroker).toHaveBeenCalledWith(expect.objectContaining({ nbrNotice: expect.stringContaining("Accepted") }));
  });

  it("sin agente y sin el consentimiento E-SIGN → 400 'esign', sin crear nada", async () => {
    const res = await post({ ...valid, esign_consent: false });
    expect(await res.json()).toEqual({ error: "esign" });
    expect(insertShowingLead).not.toHaveBeenCalled();
  });

  it("sin agente y sin aceptar el aviso → 400 'nbr', sin crear nada", async () => {
    const res = await post({ ...valid, nbr_accept: false });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nbr" });
    expect(insertShowingLead).not.toHaveBeenCalled();
  });


  it("sin consentimiento → 400", async () => {
    const res = await post({ ...valid, consent_contact: false });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "consent" });
    expect(insertShowingLead).not.toHaveBeenCalled();
  });

  it("honeypot → 200 sin crear nada", async () => {
    const res = await post({ ...valid, website: "spam" });
    expect(res.status).toBe(200);
    expect(insertShowingLead).not.toHaveBeenCalled();
  });

  it("ficha inexistente o no mostrable → 404", async () => {
    state.target = null;
    const res = await post(valid);
    expect(res.status).toBe(404);
    expect(insertShowingLead).not.toHaveBeenCalled();
  });

  it("límite de uso → 429", async () => {
    state.limited = true;
    expect((await post(valid)).status).toBe(429);
    expect(insertShowingLead).not.toHaveBeenCalled();
  });

  it("cuerpo que no es JSON → 400", async () => {
    const res = await POST(new Request("https://lixtara.com/api/showing-requests", { method: "POST", body: "x" }));
    expect(res.status).toBe(400);
  });
});

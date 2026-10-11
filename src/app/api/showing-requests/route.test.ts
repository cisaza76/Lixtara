import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  allowed: false,
  staff: false,
  limited: false,
  target: { label: "MLS #A111", ownAddress: null } as { label: string; ownAddress: string | null } | null,
  leadStatus: "received",
};
const insertShowingLead = vi.fn(async () => ({ id: "lead-1", status: state.leadStatus }));
const sendBroker = vi.fn(async () => ({ ok: true }));
const sendBuyer = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/buyer-leads.server", () => ({
  canUseShowingRequests: async () => ({ allowed: state.allowed, staff: state.staff }),
  resolveTarget: async () => state.target,
  ensureBrokerOfRecord: async () => "broker-1",
  insertShowingLead: (...a: unknown[]) => insertShowingLead(...(a as [])),
}));
vi.mock("@/lib/supabase/service", () => ({ createService: () => ({}) }));
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

const valid = {
  listing_key: "K1",
  full_name: "Jane Buyer",
  email: "jane@example.com",
  other_agent_status: "none",
  consent_contact: true,
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
    target: { label: "MLS #A111", ownAddress: null }, leadStatus: "received",
  });
  insertShowingLead.mockClear();
  sendBroker.mockClear();
  sendBuyer.mockClear();
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
    expect(await res.json()).toEqual({ ok: true, exclusive: false });
    expect(insertShowingLead).toHaveBeenCalledTimes(1);
    expect(sendBroker).toHaveBeenCalledTimes(1);
    expect(sendBuyer).toHaveBeenCalledWith(expect.objectContaining({ ownAddress: null }));
    // Sin plazo prometido al comprador: el SLA no está confirmado con la broker.
    expect((sendBuyer.mock.calls as unknown[][])[0][0]).not.toHaveProperty("responseHours");
    expect(sendBroker).toHaveBeenCalledWith(expect.objectContaining({
      consentMarketing: false, consentVersion: "2026-10-draft-2",
    }));
  });

  it("acuerdo exclusivo con otro broker → registrado, sin emails", async () => {
    state.leadStatus = "cancelled";
    const res = await post({ ...valid, other_agent_status: "exclusive" });
    expect(await res.json()).toEqual({ ok: true, exclusive: true });
    expect(insertShowingLead).toHaveBeenCalledTimes(1);
    expect(sendBroker).not.toHaveBeenCalled();
    expect(sendBuyer).not.toHaveBeenCalled();
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

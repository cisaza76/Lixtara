// La creación del acuerdo rechaza un listing incompleto (p. ej. llegando por URL al paso 7
// con los pasos 2–5 vacíos) y manda al vendedor al primer paso pendiente. Supabase, DocuSign y
// el registro de consentimientos están simulados: sin red.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENTS } from "@/lib/legal/consents";

const loadFirstIncompleteStep = vi.fn(async (): Promise<number | null> => null);
const createEnvelope = vi.fn(async () => ({ envelopeId: "env1" }));
const recordAcceptance = vi.fn(async () => true);
const fetchBuyerComp = vi.fn(async () => ({
  buyer_agent_comp_type: "percent",
  buyer_agent_commission: 2.5,
  buyer_agent_comp_amount: null,
  buyer_agent_comp_terms_version: "v",
}));

function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "order", "limit", "insert", "update"]) q[m] = () => q;
  q.maybeSingle = async () => result;
  q.single = async () => result;
  q.then = (res: (v: unknown) => unknown) => res(result);
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "s@example.com" } } }) },
    from: (t: string) =>
      t === "properties"
        ? chain({ data: { id: "p1", owner_id: "u1", pricing_tier: "pro", mls_status: "draft", list_price: 400000 } })
        : chain({ data: null, error: null }),
  }),
}));
vi.mock("@/lib/ratelimit", () => ({ apiLimiter: () => null, enforceLimit: async () => null }));
vi.mock("@/lib/listing-completeness.server", () => ({
  loadFirstIncompleteStep: (...a: unknown[]) => loadFirstIncompleteStep(...(a as [])),
}));
vi.mock("@/lib/buyer-comp.server", () => ({ fetchBuyerComp: (...a: unknown[]) => fetchBuyerComp(...(a as [])) }));
vi.mock("@/lib/legal/consents.server", () => ({ recordAcceptance: (...a: unknown[]) => recordAcceptance(...(a as [])) }));
vi.mock("@/lib/docusign", () => ({
  createEnvelopeFromTemplate: (...a: unknown[]) => createEnvelope(...(a as [])),
  getRecipientView: async () => "https://docusign.test/view",
  LIXTARA_BROKER_ROLE: "Broker",
}));

import { POST } from "./route";

const req = () =>
  new Request("https://lixtara.com/api/agreement/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ property_id: "p1", lang: "es", accept_esign: true, esign_version: CONSENTS.esign.version }),
  });

describe("POST /api/agreement/create: listing incompleto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID;
  });

  it("pasos 2–5 vacíos → 409 con el primer paso pendiente, sin DocuSign ni registro E-SIGN", async () => {
    for (const step of [1, 2, 3, 4, 5]) {
      loadFirstIncompleteStep.mockResolvedValueOnce(step);
      const res = await POST(req());
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("listing_incomplete");
      expect(body.step).toBe(step);
      expect(body.redirect).toBe(`/es/listing/new?step=${step}&id=p1`);
    }
    expect(createEnvelope).not.toHaveBeenCalled();
    expect(recordAcceptance).not.toHaveBeenCalled();
  });

  it("si no se puede comprobar → 500, sin contrato", async () => {
    loadFirstIncompleteStep.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("completeness_check_failed");
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  it("solo falta el paso 6 → el mensaje propio de la oferta", async () => {
    loadFirstIncompleteStep.mockResolvedValueOnce(6);
    fetchBuyerComp.mockResolvedValueOnce(null as never);
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("buyer_comp_not_set");
  });

  it("completo → pasa la comprobación (sigue hasta la configuración de DocuSign)", async () => {
    loadFirstIncompleteStep.mockResolvedValueOnce(null);
    const res = await POST(req());
    expect(loadFirstIncompleteStep).toHaveBeenCalledWith(expect.anything(), "p1");
    expect((await res.json()).error).toBe("template_not_configured");
  });
});

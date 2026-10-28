// La creación del acuerdo rechaza un listing incompleto (p. ej. llegando por URL al paso 7
// con los pasos 2–5 vacíos) y manda al vendedor al primer paso pendiente. Supabase, DocuSign y
// el registro de consentimientos están simulados: sin red.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENTS } from "@/lib/legal/consents";

const loadFirstIncompleteStep = vi.fn(async (): Promise<number | null> => null);
const createEnvelope = vi.fn(async (input: unknown) => ({ envelopeId: "env1", input }));
type Owners = { ownership: Record<string, unknown> | null; signers: Array<Record<string, string>> };
const ONE_SELLER: Owners = {
  ownership: { owner_kind: "individuals", other_title_holders: false, married_homestead: false, manual_review_reason: null, manual_review_cleared_at: null },
  signers: [],
};
const loadOwnership = vi.fn(async (): Promise<Owners> => ONE_SELLER);
const templateHasRole = vi.fn(async () => true);
const inserted: Array<Record<string, unknown>> = [];
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
  loadOwnership: (...a: unknown[]) => loadOwnership(...(a as [])),
}));
vi.mock("@/lib/supabase/service", () => ({
  createService: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "a1" }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/config/brokerage", async (orig) => ({
  ...(await orig<typeof import("@/config/brokerage")>()),
  brokerSigner: () => ({ name: "TEST Broker", email: "broker@example.com" }),
}));
vi.mock("@/lib/miami-dade", () => ({ verifiedLegalDescription: async () => null }));
vi.mock("@/lib/agreement-legal.server", () => ({ recordAgreementSent: async () => undefined }));
vi.mock("@/lib/buyer-comp.server", () => ({ fetchBuyerComp: (...a: unknown[]) => fetchBuyerComp(...(a as [])) }));
vi.mock("@/lib/legal/consents.server", () => ({ recordAcceptance: (...a: unknown[]) => recordAcceptance(...(a as [])) }));
vi.mock("@/lib/docusign", () => ({
  createEnvelopeFromTemplate: (input: unknown) => createEnvelope(input),
  getRecipientView: async () => ({ url: "https://docusign.test/view" }),
  LIXTARA_BROKER_ROLE: { listingAgreement: "Broker" },
  templateHasRole: (...a: unknown[]) => templateHasRole(...(a as [])),
  InvalidAdditionalSignerError: class extends Error {},
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

describe("POST /api/agreement/create: quién firma (#220)", () => {
  const LUIS = { full_name: "Luis Pérez", email: "luis@example.com", relationship: "title_holder" };
  const owners = (o: Partial<Record<string, unknown>>, signers: Owners["signers"] = []): Owners => ({
    ownership: { ...ONE_SELLER.ownership, ...o },
    signers,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    inserted.length = 0;
    loadFirstIncompleteStep.mockResolvedValue(null);
    process.env.DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID = "tpl-v4";
  });

  it("(c) otro en el título sin segundo firmante → 409 al paso 3, sin sobre", async () => {
    loadOwnership.mockResolvedValueOnce(owners({ other_title_holders: true }));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "listing_incomplete", step: 3, redirect: "/es/listing/new?step=3&id=p1" });
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  it("revisión manual sin destrabar → 409 manual_review, sin sobre", async () => {
    loadOwnership.mockResolvedValueOnce(owners({ owner_kind: "manual_review", manual_review_reason: "trust" }));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("manual_review");
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  it("segundo firmante con el correo de la cuenta → al paso 3 con 'Cada firmante necesita su propio correo'", async () => {
    loadOwnership.mockResolvedValueOnce(owners({ other_title_holders: true }, [{ ...LUIS, email: "S@example.com" }]));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).redirect).toBe("/es/listing/new?step=3&id=p1&error=signer_same_email");
  });

  it("(a) un firmante guardado que ya no corresponde → 409, sin sobre (sellers_required ≠ 1 + firmantes)", async () => {
    loadOwnership.mockResolvedValueOnce(owners({}, [LUIS]));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  it("dos vendedores: el sobre lleva a Seller 2 y el acuerdo se guarda con sellers_required 2 y plazo", async () => {
    loadOwnership.mockResolvedValueOnce(owners({ other_title_holders: true }, [LUIS]));
    const res = await POST(req());
    expect(res.status).toBe(200);
    const env = createEnvelope.mock.calls[0][0] as Record<string, unknown>;
    expect(env.additionalSigners).toEqual([
      { roleName: "Seller 2", name: "Luis Pérez", email: "luis@example.com", textTabs: { seller2_email: "luis@example.com" }, lockedTextTabs: ["seller2_email"] },
    ]);
    expect((env.textTabs as Record<string, string>).seller_name).toMatch(/ and Luis Pérez$/);
    expect(inserted[0]).toMatchObject({ sellers_required: 2 });
    expect(typeof inserted[0].signing_deadline_at).toBe("string");
  });

  it("un vendedor: sin Seller 2, sellers_required 1", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((createEnvelope.mock.calls[0][0] as Record<string, unknown>).additionalSigners).toBeUndefined();
    expect(inserted[0]).toMatchObject({ sellers_required: 1, signing_deadline_at: null });
  });

  it("dos vendedores con una plantilla sin 'Seller 2' (v3) → 503, sin sobre", async () => {
    loadOwnership.mockResolvedValueOnce(owners({ other_title_holders: true }, [LUIS]));
    templateHasRole.mockResolvedValueOnce(false);
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("second_seller_not_supported");
    expect(createEnvelope).not.toHaveBeenCalled();
  });
});

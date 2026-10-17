// No se puede pagar el plan sin la casilla de reembolso del paso 8, y sin la prueba de esa
// aceptación (terms_acceptances) la sesión de Stripe se cierra. Supabase, Stripe y el
// registro están simulados: sin red.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONSENTS } from "@/lib/legal/consents";

const createSession = vi.fn(async () => ({ sessionId: "cs_test_abc", url: "https://checkout.stripe.test/abc", livemode: false }));
const expireSession = vi.fn(async () => {});
const recordAcceptance = vi.fn(async () => true);
const decideCheckout = vi.fn(async (): Promise<Record<string, unknown>> => ({ action: "create" }));

/** Query builder mínimo: cualquier cadena termina en `result`. */
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "order", "limit", "insert"]) q[m] = () => q;
  q.maybeSingle = async () => result;
  q.then = (res: (v: unknown) => unknown) => res(result);
  return q;
}

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "s@example.com" } } }) },
    from: (t: string) =>
      t === "properties"
        ? chain({ data: { id: "p1", owner_id: "u1", pricing_tier: "pro", mls_status: "draft" } })
        : t === "agreements"
          ? chain({ data: { status: "signed" } })
          : chain({ error: null }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createService: () => ({ from: () => chain({ data: [], error: null }) }) }));
vi.mock("@/lib/ratelimit", () => ({ apiLimiter: () => null, enforceLimit: async () => null }));
vi.mock("@/lib/checkout-guard", () => ({ decideCheckout: (...a: unknown[]) => decideCheckout(...(a as [])) }));
vi.mock("@/lib/checkout-return.server", () => ({ checkoutGuardDeps: () => ({}) }));
vi.mock("@/lib/ga4-attribution", () => ({ checkoutAttribution: () => ({}) }));
vi.mock("@/lib/funnel-events.server", () => ({ recordFunnelEvent: async () => {} }));
vi.mock("@/lib/stripe", () => ({
  createTierCheckoutSession: (...a: unknown[]) => createSession(...(a as [])),
  expireCheckoutSession: (...a: unknown[]) => expireSession(...(a as [])),
}));
vi.mock("@/lib/legal/consents.server", () => ({ recordAcceptance: (...a: unknown[]) => recordAcceptance(...(a as [])) }));

import { POST } from "./route";

const req = (body: Record<string, unknown>) =>
  new Request("https://lixtara.com/api/checkout/tier", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7", "user-agent": "UA" },
    body: JSON.stringify(body),
  });
const ok = { property_id: "p1", lang: "es", accept_refund_terms: true, refund_terms_version: CONSENTS.terms_refund.version };

describe("POST /api/checkout/tier: casilla de reembolso obligatoria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAcceptance.mockResolvedValue(true);
    decideCheckout.mockResolvedValue({ action: "create" });
  });

  it("sin la casilla → 400 y no se crea sesión de Stripe", async () => {
    for (const body of [{ property_id: "p1" }, { ...ok, accept_refund_terms: false }, { ...ok, accept_refund_terms: "true" }]) {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("refund_terms_required");
    }
    expect(createSession).not.toHaveBeenCalled();
    expect(recordAcceptance).not.toHaveBeenCalled();
  });

  it("con una versión vieja de los Términos → 409", async () => {
    const res = await POST(req({ ...ok, refund_terms_version: "2020-01-01" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("refund_terms_outdated");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("aceptada → se registra con la sesión, el idioma y la versión va a Stripe", async () => {
    const res = await POST(req(ok));
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ refundTermsVersion: CONSENTS.terms_refund.version }));
    expect(recordAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({
        document: "terms_refund",
        lang: "es",
        context: "checkout_tier",
        userId: "u1",
        propertyId: "p1",
        stripeCheckoutSessionId: "cs_test_abc",
      }),
    );
  });

  it("si la aceptación no queda registrada → 503 y la sesión de Stripe se cierra", async () => {
    recordAcceptance.mockResolvedValue(false);
    const res = await POST(req(ok));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("consent_record_failed");
    expect(expireSession).toHaveBeenCalledWith("cs_test_abc");
  });

  it("al reutilizar una sesión abierta también se registra la aceptación", async () => {
    decideCheckout.mockResolvedValue({ action: "reuse", url: "https://checkout.stripe.test/old", sessionId: "cs_test_old" });
    const res = await POST(req(ok));
    expect(res.status).toBe(200);
    expect(recordAcceptance).toHaveBeenCalledWith(expect.objectContaining({ stripeCheckoutSessionId: "cs_test_old" }));
    expect(createSession).not.toHaveBeenCalled();
  });
});

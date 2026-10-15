import { describe, it, expect, vi } from "vitest";
import { decideCheckout, isCheckoutSessionId, type CheckoutSessionView, type GuardDeps } from "@/lib/checkout-guard";

function deps(sessions: Record<string, CheckoutSessionView | Error>): GuardDeps & {
  expire: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  fulfillPaid: ReturnType<typeof vi.fn>;
} {
  return {
    retrieve: vi.fn(async (id: string) => {
      const s = sessions[id];
      if (!s || s instanceof Error) throw s ?? new Error("not found");
      return s;
    }),
    expire: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    fulfillPaid: vi.fn(async () => {}),
  };
}

const view = (over: Partial<CheckoutSessionView>): CheckoutSessionView => ({
  id: "cs_test_a",
  status: "open",
  payment_status: "unpaid",
  url: "https://checkout.stripe.com/c/pay/cs_test_a",
  tier: "pro",
  ...over,
});
const pending = (id = "cs_test_a") => ({ status: "pending", stripe_checkout_session_id: id });

describe("decideCheckout: nunca dos sesiones cobrables", () => {
  it("sin pagos previos → crear", async () => {
    expect(await decideCheckout([], "pro", deps({}))).toEqual({ action: "create" });
  });

  it("pago ya confirmado → 'Estamos confirmando tu pago', sin llamar a Stripe", async () => {
    const d = deps({});
    expect(await decideCheckout([{ status: "succeeded", stripe_checkout_session_id: "cs_test_x" }], "pro", d)).toEqual({
      action: "confirming",
    });
    expect(d.retrieve).not.toHaveBeenCalled();
  });

  it("sesión abierta del mismo plan → se reutiliza su URL", async () => {
    const d = deps({ cs_test_a: view({}) });
    expect(await decideCheckout([pending()], "pro", d)).toEqual({
      action: "reuse",
      url: "https://checkout.stripe.com/c/pay/cs_test_a",
      sessionId: "cs_test_a",
    });
    expect(d.expire).not.toHaveBeenCalled();
  });

  it("sesión abierta de otro plan → se expira y se crea la nueva", async () => {
    const d = deps({ cs_test_a: view({ tier: "essentials" }) });
    expect(await decideCheckout([pending()], "pro", d)).toEqual({ action: "create" });
    expect(d.expire).toHaveBeenCalledWith("cs_test_a");
    expect(d.markFailed).toHaveBeenCalledWith("cs_test_a", "superseded");
  });

  it("sesión pagada sin webhook → se cumple y se responde confirmando", async () => {
    const d = deps({ cs_test_a: view({ status: "complete", payment_status: "paid" }) });
    expect(await decideCheckout([pending()], "pro", d)).toEqual({ action: "confirming" });
    expect(d.fulfillPaid).toHaveBeenCalledWith("cs_test_a");
  });

  it("completada con pago diferido en proceso → confirmando, sin cumplir todavía", async () => {
    const d = deps({ cs_test_a: view({ status: "complete", payment_status: "unpaid" }) });
    expect(await decideCheckout([pending()], "pro", d)).toEqual({ action: "confirming" });
    expect(d.fulfillPaid).not.toHaveBeenCalled();
  });

  it("sesión expirada → se marca fallida y se crea otra", async () => {
    const d = deps({ cs_test_a: view({ status: "expired" }) });
    expect(await decideCheckout([pending()], "pro", d)).toEqual({ action: "create" });
    expect(d.markFailed).toHaveBeenCalledWith("cs_test_a", "checkout.session.expired");
  });

  it("Stripe no responde → no se crea otra (fail-closed)", async () => {
    expect(await decideCheckout([pending()], "pro", deps({ cs_test_a: new Error("timeout") }))).toEqual({
      action: "unavailable",
    });
    const d = deps({ cs_test_a: view({ tier: "essentials" }) });
    d.expire.mockRejectedValueOnce(new Error("timeout"));
    expect(await decideCheckout([pending()], "pro", d)).toEqual({ action: "unavailable" });
  });
});

describe("isCheckoutSessionId", () => {
  it("acepta ids de Checkout y rechaza el resto", () => {
    expect(isCheckoutSessionId("cs_test_a1B2c3D4e5F6g7")).toBe(true);
    expect(isCheckoutSessionId("cs_live_a1B2c3D4e5F6g7")).toBe(true);
    for (const v of ["", "pi_123", "cs_test_", "cs_test_abc/../x", null, undefined, 1]) {
      expect(isCheckoutSessionId(v)).toBe(false);
    }
  });
});

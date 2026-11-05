import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@/lib/supabase/service", () => ({
  createService: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { is_test: false } }) }) }) }),
  }),
}));

import { sendGa4Purchase } from "@/lib/ga4-mp.server";

const session = {
  id: "cs_live_1",
  livemode: true,
  amount_total: 49500,
  currency: "usd",
  metadata: { tier: "pro", property_id: "p1", consent: "granted", ga_client_id: "1.2", lang: "en" },
} as unknown as Stripe.Checkout.Session;

describe("sendGa4Purchase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const configure = () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("GA4_MEASUREMENT_ID", "G-70H5Q9530F");
    vi.stubEnv("GA4_MP_API_SECRET", "secret");
  };

  it("envía purchase cuando se cumple todo", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await sendGa4Purchase(session);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.events[0].params).toMatchObject({ transaction_id: "cs_live_1", value: 495, currency: "USD" });
  });

  it("sesión cobrada en COP (Adaptive Pricing): value y currency en USD, de currency_conversion", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await sendGa4Purchase({
      ...session,
      amount_total: 198_000_000,
      currency: "cop",
      currency_conversion: { amount_subtotal: 49500, amount_total: 49500, fx_rate: "4000", source_currency: "usd" },
    } as unknown as Stripe.Checkout.Session);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.events[0].params).toMatchObject({ value: 495, currency: "USD" });
  });

  it("moneda distinta de USD sin conversión: no envía un valor en otra moneda", async () => {
    configure();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await sendGa4Purchase({ ...session, amount_total: 198_000_000, currency: "cop" } as Stripe.Checkout.Session);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("nunca lanza si GA4 falla (el webhook de Stripe responde 200 igual)", async () => {
    configure();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(sendGa4Purchase(session)).resolves.toBeUndefined();
  });

  it("Production con pago de prueba, o Preview con una compra real: no envía", async () => {
    configure();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await sendGa4Purchase({ ...session, livemode: false } as Stripe.Checkout.Session);
    vi.stubEnv("VERCEL_ENV", "preview");
    await sendGa4Purchase(session);
    vi.stubEnv("VERCEL_ENV", "development");
    await sendGa4Purchase({ ...session, livemode: false } as Stripe.Checkout.Session);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Preview con compra de prueba: envía con debug_mode: 1 (plan y los otros tres productos)", async () => {
    configure();
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const test = (metadata: Record<string, string>) =>
      ({ ...session, id: "cs_test_1", livemode: false, metadata: { consent: "granted", ga_client_id: "1.2", ...metadata } }) as unknown as Stripe.Checkout.Session;
    await sendGa4Purchase(test({ tier: "pro", property_id: "p1" }));
    await sendGa4Purchase(test({ kind: "consultation" }));
    await sendGa4Purchase(test({ kind: "photography", property_id: "p1" }));
    await sendGa4Purchase(test({ kind: "staging_overage" }));
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const call of fetch.mock.calls) {
      expect(JSON.parse(call[1].body).events[0].params).toMatchObject({ transaction_id: "cs_test_1", debug_mode: 1 });
    }
  });

  it("Production: sin debug_mode", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await sendGa4Purchase(session);
    expect(JSON.parse(fetch.mock.calls[0][1].body).events[0].params).not.toHaveProperty("debug_mode");
  });
});

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

  it("nunca lanza si GA4 falla (el webhook de Stripe responde 200 igual)", async () => {
    configure();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(sendGa4Purchase(session)).resolves.toBeUndefined();
  });

  it("modo de prueba de Stripe o fuera de Production: no envía", async () => {
    configure();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await sendGa4Purchase({ ...session, livemode: false } as Stripe.Checkout.Session);
    vi.stubEnv("VERCEL_ENV", "preview");
    await sendGa4Purchase(session);
    expect(fetch).not.toHaveBeenCalled();
  });
});

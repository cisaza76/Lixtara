import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<Array<{ html: string; text: string }>> }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (...args: Array<{ html: string; text: string }>) => {
        h.calls.push(args);
        return { data: { id: "email-1" }, error: null };
      },
    };
  },
}));

import { sendPaymentReceipt } from "@/lib/email";

describe("recibo de pago: recuerda el % al cierre, solo si se vende", () => {
  afterEach(() => {
    h.calls.length = 0;
    vi.unstubAllEnvs();
  });

  const base = { to: "s@example.com", amount: 495, tier: "pro", propertyAddress: "1 A St", dashboardUrl: "https://x/d" };

  it("EN y ES, en HTML y en texto, con el % del plan", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await sendPaymentReceipt({ ...base, lang: "en" });
    await sendPaymentReceipt({ ...base, lang: "es", tier: "concierge", amount: 995 });
    const [en, es] = h.calls.map((c) => c[0]!);
    expect(en.html).toContain("1% Lixtara commission on the sale price, paid at closing and only if your property sells");
    expect(en.text).toContain("1% Lixtara commission");
    expect(es.html).toContain("comisión de Lixtara del 1.5% del precio de venta, que se paga al cierre y solo si tu propiedad se vende");
    expect(es.text).toContain("1.5%");
  });
});

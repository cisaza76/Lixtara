// Correos internos: el teléfono del vendedor, del visitante o del comprador se lee siempre
// igual, "+1 (305) 522-3454", venga como venga (E.164 de la base, con guiones…).
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<Array<Record<string, unknown>>> }));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (...args: Array<Record<string, unknown>>) => {
        h.calls.push(args);
        return { data: { id: "email-1" }, error: null };
      },
    };
  },
}));

import { sendBrokerShowingRequest, sendContactMessage, sendContractPreparingInternal } from "@/lib/email";

const PRETTY = "+1 (305) 522-3454";
const last = () => {
  const [msg] = h.calls.at(-1)!;
  return { html: String(msg.html), text: String(msg.text) };
};

describe("teléfono formateado en los correos internos", () => {
  afterEach(() => {
    h.calls.length = 0;
    vi.unstubAllEnvs();
  });

  it("Contrato por preparar: E.164 → +1 (305) 522-3454; sin teléfono → —", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const base = {
      to: "anamaria@lixtara.com",
      propertyId: "p1",
      propertyAddress: "1 Ocean Dr, Miami, FL 33139",
      tier: "pro",
      listPrice: 650000,
      cosigner: null,
      reviewUrl: "https://lixtara.com/es/admin/listings/p1/review",
      idempotencyKey: "k",
    };
    await sendContractPreparingInternal({ ...base, seller: { name: "Ana", email: "ana@example.com", phone: "+13055223454", lang: "es" } });
    expect(last().html).toContain(PRETTY);
    expect(last().html).not.toContain("+13055223454");
    await sendContractPreparingInternal({ ...base, seller: { name: "Ana", email: "ana@example.com", phone: null, lang: "es" } });
    expect(last().html).toMatch(/Teléfono<\/td><td[^>]*>—</);
  });

  it("formulario de contacto: 305-522-3454 → +1 (305) 522-3454 (HTML y texto)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await sendContactMessage({ to: "camilo@lixtara.com", lang: "en", name: "Ana", email: "ana@example.com", phone: "305-522-3454", topic: "selling", message: "Hola", pageUrl: "https://lixtara.com/en/contact" });
    expect(last().html).toContain(PRETTY);
    expect(last().text).toContain(`Phone: ${PRETTY}`);
  });

  it("solicitud de visita: E.164 → +1 (305) 522-3454; un número de otro país queda como vino", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const base = {
      to: "anamaria@lixtara.com",
      buyerName: "Luis",
      buyerEmail: "luis@example.com",
      target: "1 Ocean Dr",
      preferredTimes: null,
      message: null,
      otherAgentStatus: "none",
      needsToSell: null,
      consentMarketing: false,
      consentVersion: "v1",
      respondBy: "2026-11-11T15:00:00Z",
      lang: "en" as const,
      adminUrl: "https://lixtara.com/en/admin/showings",
    };
    await sendBrokerShowingRequest({ ...base, buyerPhone: "+13055223454" });
    expect(last().html).toContain(PRETTY);
    await sendBrokerShowingRequest({ ...base, buyerPhone: "+573001234567" });
    expect(last().html).toContain("+573001234567");
  });
});

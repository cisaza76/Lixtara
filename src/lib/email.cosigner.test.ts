// Correos del segundo vendedor (#220): la invitación explica qué firma y por qué, en los dos
// idiomas (no sabemos el suyo), con lo que escribió el vendedor escapado.
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

import { sendAllSellersSigned, sendCosignerExpired, sendCosignerInvitation, sendCosignerSigned, sendSigningExpired } from "@/lib/email";

const invite = {
  to: "luis@example.com",
  kind: "invite" as const,
  sellerName: "Ana <b>Pérez</b>",
  signerName: "Luis Pérez",
  relationship: "homestead_spouse" as const,
  propertyAddress: "1 Ocean Dr, Miami, FL 33139",
  deadlineIso: "2026-11-09T15:00:00Z",
  idempotencyKey: "cosigner-invite:a1",
};

describe("correos del segundo vendedor", () => {
  afterEach(() => {
    h.calls.length = 0;
    vi.unstubAllEnvs();
  });

  it("invitación: los dos idiomas, primero el del vendedor; el porqué (homestead) y el plazo en hora de Miami", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await sendCosignerInvitation({ ...invite, lang: "es" });
    const [msg, opts] = h.calls[0]!;
    const html = String(msg.html);
    const text = String(msg.text);
    expect(msg.subject).toBe("Ana <b>Pérez</b> te pidió firmar el acuerdo de listado de 1 Ocean Dr, Miami, FL 33139");
    expect(html.indexOf("Hola, Luis Pérez")).toBeLessThan(html.indexOf("Hi Luis Pérez"));
    expect(html).toContain("residencia principal (homestead) de un propietario casado");
    expect(html).toContain("primary residence (homestead) of a married owner");
    expect(html).toContain("9 de noviembre de 2026");
    expect(html).toContain("November 9, 2026");
    expect(html).toContain("Ana &lt;b&gt;Pérez&lt;/b&gt;");
    expect(html).not.toContain("<b>Pérez</b>");
    expect(text).toContain("Ana <b>Pérez</b> quiere poner a la venta 1 Ocean Dr");
    expect(text).not.toContain("&lt;");
    expect(opts).toEqual({ idempotencyKey: "cosigner-invite:a1" });
  });

  it("titular en el título y recordatorio", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await sendCosignerInvitation({ ...invite, lang: "en", kind: "reminder", relationship: "title_holder", idempotencyKey: "k" });
    const [msg] = h.calls[0]!;
    expect(msg.subject).toBe("Reminder: the listing agreement for 1 Ocean Dr, Miami, FL 33139 is waiting for your signature");
    expect(String(msg.html)).toContain("on the property's title together with Ana &lt;b&gt;Pérez&lt;/b&gt;");
    expect(String(msg.html)).toContain("figuras en el título de la propiedad");
  });

  it("al vendedor: firmó el segundo, y plazo vencido (sin cobro, el listing sigue en borrador)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    await sendCosignerSigned({ to: "ana@example.com", lang: "es", signerName: "Luis", propertyAddress: "1 Ocean Dr", stepUrl: "https://x/7" });
    await sendSigningExpired({
      to: "ana@example.com",
      lang: "en",
      signerName: "Luis",
      propertyAddress: "1 Ocean Dr",
      stepUrl: "https://x/7",
      idempotencyKey: "signing-expired:a1:seller",
    });
    await sendCosignerExpired({ to: "luis@example.com", lang: "es", sellerName: "Ana", propertyAddress: "1 Ocean Dr", idempotencyKey: "k2" });
    const [signed, expired, cosigner] = h.calls.map((c) => c[0]!);
    expect(signed.subject).toBe("Luis firmó el acuerdo de listado");
    expect(String(signed.html)).toContain("Solo falta tu firma");
    expect(String(expired.html)).toContain("Your listing is still a draft and you haven't been charged.");
    expect(h.calls[1]![1]).toEqual({ idempotencyKey: "signing-expired:a1:seller" });
    expect(String(cosigner.text)).toContain("venció sin tu firma");
    expect(String(cosigner.text)).toContain("expired without your signature");
  });

  it("ya firmaron todos: al vendedor, EN/ES, con el enlace al pago, dirección escapada y una sola vez (clave)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const input = { to: "ana@example.com", propertyAddress: "1 <i>Ocean</i> Dr", paymentUrl: "https://lixtara.com/es/listing/new?id=p1&step=8", idempotencyKey: "all-sellers-signed:a1" };
    await sendAllSellersSigned({ ...input, lang: "es" });
    await sendAllSellersSigned({ ...input, lang: "en" });
    const [es, esOpts] = h.calls[0]!;
    const [en] = h.calls[1]!;
    expect(es.subject).toBe("Ya firmaron todos: completa el pago para continuar");
    expect(String(es.html)).toContain("Ya firmaron todos.");
    expect(String(es.html)).toContain("Completa el pago de tu tarifa fija para continuar.");
    expect(String(es.html)).toContain("1 &lt;i&gt;Ocean&lt;/i&gt; Dr");
    expect(String(es.html)).toContain(input.paymentUrl);
    expect(String(es.text)).toContain("1 <i>Ocean</i> Dr");
    expect(esOpts).toEqual({ idempotencyKey: "all-sellers-signed:a1" });
    expect(en.subject).toBe("Everyone has signed: complete the payment to continue");
    expect(String(en.html)).toContain("Complete the payment of your flat fee to continue.");
  });
});

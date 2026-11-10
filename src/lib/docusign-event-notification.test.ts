// eventNotification por sobre: solo en Production, al webhook de la URL del sitio, con los 6
// eventos, SIM + REST v2.1 JSON, acuse obligatorio y HMAC; el token solo si está configurado.
import { describe, it, expect, vi } from "vitest";
import { ENVELOPE_EVENTS, envelopeEventNotification } from "./docusign-event-notification";

const TOKEN = "t".repeat(40);
const prod = (extra: Record<string, string> = {}) =>
  ({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://lixtara.com", ...extra }) as unknown as NodeJS.ProcessEnv;

describe("envelopeEventNotification", () => {
  it("Production: webhook de lixtara.com, 6 eventos, SIM, restv2.1 JSON, acuse y HMAC", () => {
    expect(envelopeEventNotification(prod())).toEqual({
      url: "https://lixtara.com/api/webhooks/docusign",
      requireAcknowledgment: "true",
      includeHMAC: "true",
      loggingEnabled: "true",
      deliveryMode: "SIM",
      eventData: { version: "restv2.1", format: "json" },
      events: [
        "envelope-sent",
        "envelope-delivered",
        "envelope-completed",
        "envelope-declined",
        "envelope-voided",
        "recipient-completed",
      ],
    });
    expect(ENVELOPE_EVENTS).toContain("envelope-declined");
  });

  it("la URL del sitio con barra o ruta final → solo el origen", () => {
    expect(envelopeEventNotification(prod({ NEXT_PUBLIC_SITE_URL: "https://lixtara.com/en/" }))?.url).toBe(
      "https://lixtara.com/api/webhooks/docusign",
    );
  });

  it("con DOCUSIGN_WEBHOOK_TOKEN → el token va en la URL; sigue pidiendo HMAC", () => {
    const en = envelopeEventNotification(prod({ DOCUSIGN_WEBHOOK_TOKEN: TOKEN }));
    expect(en?.url).toBe(`https://lixtara.com/api/webhooks/docusign?token=${TOKEN}`);
    expect(en?.includeHMAC).toBe("true");
  });

  it("token demasiado corto → no se pone (y se avisa)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(envelopeEventNotification(prod({ DOCUSIGN_WEBHOOK_TOKEN: "short" }))?.url).toBe(
      "https://lixtara.com/api/webhooks/docusign",
    );
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("Preview, Development y local → sin eventNotification", () => {
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      const env = { VERCEL_ENV, NEXT_PUBLIC_SITE_URL: "https://preview.lixtara.com" } as unknown as NodeJS.ProcessEnv;
      expect(envelopeEventNotification(env)).toBeUndefined();
    }
  });

  it("Production sin URL del sitio, o sin https → sin eventNotification (y se avisa)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(envelopeEventNotification({ VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(envelopeEventNotification(prod({ NEXT_PUBLIC_SITE_URL: "http://lixtara.com" }))).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

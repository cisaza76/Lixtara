import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LISTING_STEP_SLUGS, disableAnalytics, enableAnalytics, listingStepEvent, resultsBucket, track,
} from "@/lib/analytics";
import { analyticsConfig, readConsent, sanitizeUrl } from "@/lib/analytics-config";
import { captureServerEvent } from "@/lib/analytics.server";

describe("listingStepEvent", () => {
  it("names each of the 8 listing steps with a stable slug", () => {
    expect(LISTING_STEP_SLUGS).toHaveLength(8);
    expect(listingStepEvent(1, "es")).toEqual({
      event: "listing_step_view",
      step: 1,
      step_name: "address",
      lang: "es",
    });
    expect(listingStepEvent(8, "en").step_name).toBe("payment");
  });

  it("falls back for an out-of-range step", () => {
    expect(listingStepEvent(9, "en").step_name).toBe("step_9");
  });
});

describe("track: nada sale sin consentimiento", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    disableAnalytics();
  });
  const dl = () => (globalThis as unknown as { window: Window }).window.dataLayer;

  it("sin consentimiento no empuja nada ni deja nada encolado", () => {
    track({ event: "loui_open", lang: "en" });
    expect(dl()).toBeUndefined();
  });

  it("con consentimiento va a dataLayer (GTM) y a PostHog, sin el nombre duplicado en las props", () => {
    const capture = vi.fn();
    enableAnalytics({ capture });
    track({ event: "loui_open", lang: "en" });
    expect(dl()).toEqual([{ event: "loui_open", lang: "en" }]);
    expect(capture).toHaveBeenCalledWith("loui_open", { lang: "en" });
  });

  it("retirar el consentimiento corta el envío", () => {
    const capture = vi.fn();
    enableAnalytics({ capture });
    disableAnalytics();
    track({ event: "loui_open", lang: "en" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("cubos de resultados, nunca el número exacto", () => {
    expect([0, 1, 24, 25, 100, 50_000].map(resultsBucket)).toEqual(["0", "1-24", "1-24", "25-100", "25-100", "100+"]);
  });
});

describe("configuración", () => {
  it("sin variables no hay analítica; con formas válidas sí", () => {
    expect(analyticsConfig({}).enabled).toBe(false);
    expect(analyticsConfig({ NEXT_PUBLIC_GTM_ID: "GTM-ABC1234" })).toMatchObject({ gtmId: "GTM-ABC1234", enabled: true });
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_" + "a".repeat(40) }).posthogKey).not.toBeNull();
  });

  it("valores con forma inválida se ignoran", () => {
    const c = analyticsConfig({ NEXT_PUBLIC_GTM_ID: "<script>", NEXT_PUBLIC_POSTHOG_KEY: "sk_live_x", NEXT_PUBLIC_POSTHOG_HOST: "http://evil" });
    expect(c).toEqual({ gtmId: null, posthogKey: null, posthogHost: "https://us.i.posthog.com", enabled: false });
  });

  it("lee la elección de la cookie", () => {
    expect(readConsent("a=1; lx_consent=granted; b=2")).toBe("granted");
    expect(readConsent("lx_consent=denied")).toBe("denied");
    expect(readConsent("lx_consent=maybe")).toBeNull();
    expect(readConsent("")).toBeNull();
  });

  it("URLs sin parámetros ni fragmento", () => {
    expect(sanitizeUrl("https://lixtara.com/en/properties?zip=33130&page=2#x")).toBe("https://lixtara.com/en/properties");
    expect(sanitizeUrl("no es url")).toBe("");
  });
});

describe("eventos de servidor", () => {
  const key = "phc_" + "b".repeat(40);

  it("sin clave de PostHog no hace nada", async () => {
    const fetchImpl = vi.fn();
    await captureServerEvent({ event: "listing_published", distinctId: "property:p1", props: {} }, { fetchImpl, env: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("envía solo id interno y propiedades de lista cerrada", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await captureServerEvent(
      { event: "buyer_lead_status_changed", distinctId: "lead:abc", props: { from: "received", to: "contacted" } },
      { fetchImpl: fetchImpl as never, env: { NEXT_PUBLIC_POSTHOG_KEY: key, VERCEL_ENV: "production" } },
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      api_key: key, event: "buyer_lead_status_changed", distinct_id: "lead:abc",
      properties: { from: "received", to: "contacted", environment: "production" },
    });
  });

  it("nunca lanza aunque PostHog falle", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => { throw new Error("down"); });
    await expect(captureServerEvent({ event: "listing_published", distinctId: "property:p1", props: {} },
      { fetchImpl: fetchImpl as never, env: { NEXT_PUBLIC_POSTHOG_KEY: key } })).resolves.toBeUndefined();
    errores.mockRestore();
  });
});

describe("política de cookies según el estado real", () => {
  it("sin analítica, el texto actual; con analítica, cada párrafo afectado se reemplaza (EN y ES)", async () => {
    const { cookiesDoc, cookiesDocFor, ANALYTICS_REPLACEMENT_SOURCES } = await import("@/lib/legal/cookies");
    for (const lang of ["en", "es"] as const) {
      expect(cookiesDocFor(lang, false)).toBe(cookiesDoc[lang]);
      const original = JSON.stringify(cookiesDoc[lang]);
      const conAnalitica = JSON.stringify(cookiesDocFor(lang, true));
      // Cada texto a reemplazar existe hoy (si alguien lo edita, esta prueba avisa)…
      for (const from of ANALYTICS_REPLACEMENT_SOURCES[lang]) {
        expect(original.includes(JSON.stringify(from).slice(1, -1)), from.slice(0, 40)).toBe(true);
        // …y ya no aparece en la variante con analítica.
        expect(conAnalitica.includes(JSON.stringify(from).slice(1, -1)), from.slice(0, 40)).toBe(false);
      }
      expect(conAnalitica).toMatch(/PostHog/);
      expect(conAnalitica).toMatch(/Google Analytics 4/);
    }
  });
});

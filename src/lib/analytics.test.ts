import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// El módulo lee la configuración al cargar: estas pruebas usan un build CONFIGURADO (las dos
// variables), salvo la que verifica justamente lo contrario.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_GTM_ID = "GTM-ABC1234";
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_" + "a".repeat(40);
});
import {
  LISTING_STEP_SLUGS, disableAnalytics, enableAnalytics, listingStepEvent, resultsBucket, track,
} from "@/lib/analytics";
import {
  analyticsConfig, isAnalyticsExcludedPath, readConsent, sanitizePosthogProperties, sanitizeUrl,
} from "@/lib/analytics-config";
import { recordServerEvent } from "@/lib/analytics.server";

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
    (globalThis as { window?: unknown }).window = { location: { pathname: "/en" } };
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
    expect(analyticsConfig({ NEXT_PUBLIC_GTM_ID: "GTM-ABC1234", NEXT_PUBLIC_POSTHOG_KEY: "phc_" + "a".repeat(40) }))
      .toMatchObject({ gtmId: "GTM-ABC1234", posthogKey: "phc_" + "a".repeat(40), enabled: true });
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

describe("lo que recibe PostHog", () => {
  it("URLs y referrers sin parámetros ni fragmento, sin título de página", () => {
    const out = sanitizePosthogProperties({
      $current_url: "https://lixtara.com/en/listing/continue?token=secret#x",
      $referrer: "https://lixtara.com/en/properties?zip=33143",
      $initial_referrer: "$direct",
      $initial_current_url: "not a url",
      title: "123 Main St | Lixtara",
      lang: "en",
    });
    expect(out).toEqual({
      $current_url: "https://lixtara.com/en/listing/continue",
      $referrer: "https://lixtara.com/en/properties",
      $initial_referrer: "$direct",
      $initial_current_url: "$direct",
      lang: "en",
    });
  });
});

describe("todo o nada: variables parciales no activan nada", () => {
  const gtm = "GTM-ABC1234";
  const key = "phc_" + "a".repeat(40);
  it("hace falta GTM y PostHog, ambos con forma válida", () => {
    expect(analyticsConfig({ NEXT_PUBLIC_GTM_ID: gtm, NEXT_PUBLIC_POSTHOG_KEY: key }).enabled).toBe(true);
    for (const env of [
      {},
      { NEXT_PUBLIC_GTM_ID: gtm },
      { NEXT_PUBLIC_POSTHOG_KEY: key },
      { NEXT_PUBLIC_GTM_ID: gtm, NEXT_PUBLIC_POSTHOG_KEY: "phc_short" },
      { NEXT_PUBLIC_GTM_ID: "G-12345", NEXT_PUBLIC_POSTHOG_KEY: key },
      { NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com" },
    ]) {
      expect(analyticsConfig(env), JSON.stringify(env)).toEqual({
        gtmId: null, posthogKey: null, posthogHost: expect.any(String), enabled: false,
      });
    }
  });

  it("en un build sin las dos variables, track() no hace nada aunque haya cookie 'granted' y alguien llame enableAnalytics", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", gtm);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.resetModules();
    const fresh = await import("@/lib/analytics");
    const w = globalThis as unknown as { window?: unknown; document?: unknown };
    w.window = { location: { pathname: "/en" } };
    w.document = { cookie: "lx_consent=granted" };
    const capture = vi.fn();
    fresh.enableAnalytics({ capture });
    fresh.track({ event: "loui_open", lang: "en" });
    expect((w.window as Window).dataLayer).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("eventos de servidor: se quedan en nuestra infraestructura", () => {
  it("una línea JSON en los logs, sin identificadores, y ningún envío externo", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = vi.fn();
    recordServerEvent(
      { event: "buyer_lead_status_changed", props: { from: "received", to: "contacted" } },
      { log, env: { VERCEL_ENV: "production", NEXT_PUBLIC_POSTHOG_KEY: "phc_" + "b".repeat(40) } },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const line = JSON.parse(log.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      event: "lx_server_event", name: "buyer_lead_status_changed",
      props: { from: "received", to: "contacted" }, environment: "production",
    });
    expect(Object.keys(line).sort()).toEqual(["at", "environment", "event", "name", "props"]);
    fetchSpy.mockRestore();
  });

  it("un texto libre colado por error se registra como 'invalid'", () => {
    const log = vi.fn();
    recordServerEvent(
      { event: "buyer_lead_status_changed", props: { from: "received", to: "Juan Pérez juan@x.com" } },
      { log, env: {} },
    );
    expect(JSON.parse(log.mock.calls[0][0] as string).props).toEqual({ from: "received", to: "invalid" });
  });

  it("nunca lanza", () => {
    expect(() => recordServerEvent({ event: "listing_published", props: {} }, {
      log: () => { throw new Error("boom"); },
    })).not.toThrow();
  });
});

describe("consentimiento antes de que monte el banner, retención y staff", () => {
  const w = globalThis as unknown as { window?: unknown; document?: unknown };
  beforeEach(() => {
    disableAnalytics();
  });
  function page(pathname: string, cookie: string) {
    w.window = { location: { pathname } };
    w.document = { cookie };
  }

  const configured = () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-ABC1234");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_" + "a".repeat(40));
  };

  it("con la cookie 'granted' de una visita anterior, un evento temprano no se pierde y PostHog lo recibe al cargar", async () => {
    configured();
    vi.resetModules();
    const fresh = await import("@/lib/analytics");
    page("/en/properties", "lx_consent=granted");
    fresh.track({ event: "loui_open", lang: "en" });
    expect((w.window as Window).dataLayer).toEqual([{ event: "loui_open", lang: "en" }]);
    const capture = vi.fn();
    fresh.enableAnalytics({ capture });
    expect(capture).toHaveBeenCalledWith("loui_open", { lang: "en" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("con la cookie 'denied' o sin elección, nada", async () => {
    configured();
    for (const cookie of ["lx_consent=denied", ""]) {
      vi.resetModules();
      const fresh = await import("@/lib/analytics");
      page("/en/properties", cookie);
      fresh.track({ event: "loui_open", lang: "en" });
      expect((w.window as Window).dataLayer).toBeUndefined();
    }
  });

  it("retirar el consentimiento descarta lo retenido para PostHog", () => {
    page("/en", "lx_consent=granted");
    enableAnalytics(null);
    track({ event: "loui_open", lang: "en" });
    disableAnalytics();
    const capture = vi.fn();
    enableAnalytics({ capture });
    expect(capture).not.toHaveBeenCalled();
  });

  it("en el panel de staff (/admin) no corre nunca", () => {
    page("/en/admin/buyer-leads", "lx_consent=granted");
    const capture = vi.fn();
    enableAnalytics({ capture });
    track({ event: "loui_open", lang: "en" });
    expect(capture).not.toHaveBeenCalled();
    expect((w.window as Window).dataLayer).toBeUndefined();
    expect(isAnalyticsExcludedPath("/es/admin")).toBe(true);
    expect(isAnalyticsExcludedPath("/en/administrator-guide")).toBe(false);
    expect(isAnalyticsExcludedPath("/en/properties")).toBe(false);
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// El módulo lee la configuración al cargar: estas pruebas usan un build CONFIGURADO (las dos
// variables), salvo la que verifica justamente lo contrario.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_GTM_ID = "GTM-ABC1234";
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_" + "a".repeat(40);
});
import {
  LISTING_STEP_SLUGS, disableAnalytics, enableAnalytics, listingErrorField, listingStepCompleteEvent, listingStepEvent,
  resultsBucket, track, trackThen,
} from "@/lib/analytics";
import {
  ANALYTICS_COOKIE_RE, GRANTED_CONSENT, analyticsConfig, consentTools, isAnalyticsExcludedPath, readConsent,
  sanitizePosthogProperties, sanitizeUrl,
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

describe("listing_step_complete", () => {
  it("plan_tier desde el paso 2, fotos solo en el 5", () => {
    expect(listingStepCompleteEvent({ step: 1, lang: "es", planTier: "pro" })).toEqual({
      event: "listing_step_complete", step: 1, step_name: "address", lang: "es",
    });
    expect(listingStepCompleteEvent({ step: 2, lang: "en", planTier: "pro" })).toEqual({
      event: "listing_step_complete", step: 2, step_name: "plan", plan_tier: "pro", lang: "en",
    });
    expect(listingStepCompleteEvent({ step: 5, lang: "en", planTier: "essentials", photosCount: 12 })).toMatchObject({
      step_name: "photos", plan_tier: "essentials", photos_count: 12,
    });
    expect(listingStepCompleteEvent({ step: 4, lang: "en", planTier: "pro", photosCount: 12 })).not.toHaveProperty("photos_count");
    expect(listingStepCompleteEvent({ step: 7, lang: "en", planTier: "gold" })).not.toHaveProperty("plan_tier");
  });

  it("errores: el nombre del campo, y nada para los fallos del sistema", () => {
    expect(listingErrorField("invalid_beds")).toBe("bedrooms");
    expect(listingErrorField("rights_required")).toBe("photo_rights");
    expect(listingErrorField("save_failed")).toBeNull();
    expect(listingErrorField("toString")).toBeNull();
    expect(listingErrorField(undefined)).toBeNull();
  });
});

describe("trackThen: begin_checkout antes de salir a Stripe", () => {
  const begin = { event: "begin_checkout", plan_tier: "pro", value: 495, currency: "USD", lang: "es" } as const;
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { location: { pathname: "/es/listing/new" } };
    disableAnalytics();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  const dl = () => (globalThis as unknown as { window: Window }).window.dataLayer as Array<Record<string, unknown>>;

  it("sin consentimiento redirige enseguida y no empuja nada", () => {
    const done = vi.fn();
    trackThen(begin, done);
    expect(done).toHaveBeenCalledTimes(1);
    expect(dl()).toBeUndefined();
  });

  it("con consentimiento espera el eventCallback de GTM, una sola vez", () => {
    enableAnalytics(null);
    const done = vi.fn();
    trackThen(begin, done);
    const pushed = dl()[0];
    expect(pushed).toMatchObject({ ...begin, eventTimeout: 1000 });
    expect(done).not.toHaveBeenCalled();
    (pushed.eventCallback as () => void)();
    vi.advanceTimersByTime(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("si GTM nunca responde, redirige igual pasado el tiempo", () => {
    enableAnalytics(null);
    const done = vi.fn();
    trackThen(begin, done);
    vi.advanceTimersByTime(1100);
    expect(done).toHaveBeenCalledTimes(1);
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

describe("cada herramienta por su lado (GTM ya no depende de PostHog)", () => {
  const gtm = "GTM-ABC1234";
  const key = "phc_" + "a".repeat(40);
  it("basta una herramienta con forma válida; la inválida se ignora sin apagar la otra", () => {
    expect(analyticsConfig({ NEXT_PUBLIC_GTM_ID: gtm })).toMatchObject({ gtmId: gtm, posthogKey: null, enabled: true });
    expect(analyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: key })).toMatchObject({ gtmId: null, posthogKey: key, enabled: true });
    expect(analyticsConfig({ NEXT_PUBLIC_GTM_ID: gtm, NEXT_PUBLIC_POSTHOG_KEY: "phc_short" }))
      .toMatchObject({ gtmId: gtm, posthogKey: null, enabled: true });
    expect(analyticsConfig({ NEXT_PUBLIC_GTM_ID: "G-12345", NEXT_PUBLIC_POSTHOG_KEY: key }))
      .toMatchObject({ gtmId: null, posthogKey: key, enabled: true });
    for (const env of [{}, { NEXT_PUBLIC_GTM_ID: "G-12345" }, { NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com" }]) {
      expect(analyticsConfig(env), JSON.stringify(env)).toEqual({
        gtmId: null, posthogKey: null, posthogHost: expect.any(String), enabled: false,
      });
    }
  });

  it("en un build sin ninguna herramienta, track() no hace nada aunque haya cookie 'granted' y alguien llame enableAnalytics", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
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

  it("con GTM solo, track() llega al dataLayer y no retiene nada para PostHog", async () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", gtm);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.resetModules();
    const fresh = await import("@/lib/analytics");
    const w = globalThis as unknown as { window?: unknown; document?: unknown };
    w.window = { location: { pathname: "/en" } };
    w.document = { cookie: "lx_consent=granted" };
    fresh.enableAnalytics(null);
    fresh.track({ event: "loui_open", lang: "en" });
    expect((w.window as Window).dataLayer).toEqual([{ event: "loui_open", lang: "en" }]);
    // Si después apareciera un cliente, no recibe eventos viejos: no había nada retenido.
    const capture = vi.fn();
    fresh.enableAnalytics({ capture });
    expect(capture).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("consentimiento: lo que concede 'Aceptar' y lo que se borra al rechazar", () => {
  it("aceptar concede analítica y publicidad (opt-in: antes de aceptar no se carga nada)", () => {
    expect(GRANTED_CONSENT).toEqual({
      ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted",
    });
  });

  it("al rechazar se borran las cookies de GA4, Google Ads, Meta, Clarity y PostHog, y no las propias del sitio", () => {
    for (const c of ["_ga", "_ga_ABC123", "_gid", "_gcl_au", "_fbp", "_fbc", "_clck", "_clsk", "ph_phc_x_posthog", "lx_ft"]) {
      expect(ANALYTICS_COOKIE_RE.test(c), c).toBe(true);
    }
    for (const c of ["lx_consent", "sb-access-token", "NEXT_LOCALE", "gallery_view"]) {
      expect(ANALYTICS_COOKIE_RE.test(c), c).toBe(false);
    }
  });

  it("el banner nombra solo las herramientas configuradas", () => {
    const gtm = "GTM-ABC1234";
    const key = "phc_" + "a".repeat(40);
    expect(consentTools({ gtmId: gtm, posthogKey: null }, "en")).toBe("Google Analytics, Microsoft Clarity, Google Ads and Meta");
    expect(consentTools({ gtmId: gtm, posthogKey: key }, "es")).toBe("Google Analytics, Microsoft Clarity, Google Ads, Meta y PostHog");
    expect(consentTools({ gtmId: null, posthogKey: key }, "en")).toBe("PostHog");
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
  const combos = [
    { gtm: true, posthog: true },
    { gtm: true, posthog: false },
    { gtm: false, posthog: true },
  ];

  it("sin herramientas, el texto actual; con alguna, cada párrafo afectado se reemplaza (EN y ES)", async () => {
    const { cookiesDoc, cookiesDocFor, cookieReplacementSources } = await import("@/lib/legal/cookies");
    for (const lang of ["en", "es"] as const) {
      expect(cookiesDocFor(lang, { gtm: false, posthog: false })).toBe(cookiesDoc[lang]);
      const original = JSON.stringify(cookiesDoc[lang]);
      for (const tools of combos) {
        const variante = JSON.stringify(cookiesDocFor(lang, tools));
        for (const from of cookieReplacementSources(lang, tools)) {
          const needle = JSON.stringify(from).slice(1, -1);
          // Cada texto a reemplazar existe hoy (si alguien lo edita, esta prueba avisa)…
          expect(original.includes(needle), `${lang} ${JSON.stringify(tools)} ${from.slice(0, 40)}`).toBe(true);
          // …y ya no aparece en la variante.
          expect(variante.includes(needle), `${lang} ${JSON.stringify(tools)} ${from.slice(0, 40)}`).toBe(false);
        }
      }
    }
  });

  it("nombra exactamente lo que el sitio carga: publicidad y Clarity solo con GTM, PostHog solo con su variable", async () => {
    const { cookiesDocFor } = await import("@/lib/legal/cookies");
    for (const lang of ["en", "es"] as const) {
      const ambos = JSON.stringify(cookiesDocFor(lang, { gtm: true, posthog: true }));
      expect(ambos).toMatch(/Google Analytics 4/);
      expect(ambos).toMatch(/Microsoft Clarity/);
      expect(ambos).toMatch(/Google Ads/);
      expect(ambos).toMatch(/Meta Pixel/);
      expect(ambos).toMatch(/PostHog/);

      const soloGtm = JSON.stringify(cookiesDocFor(lang, { gtm: true, posthog: false }));
      expect(soloGtm).toMatch(/Meta Pixel/);
      expect(soloGtm).not.toMatch(/PostHog/);

      const soloPosthog = JSON.stringify(cookiesDocFor(lang, { gtm: false, posthog: true }));
      expect(soloPosthog).toMatch(/PostHog/);
      for (const ausente of [/Google Analytics/, /Clarity/, /Google Ads/, /Meta/]) expect(soloPosthog).not.toMatch(ausente);
      // Sin GTM, la sección de publicidad sigue diciendo que no se usa.
      expect(soloPosthog).toMatch(lang === "en" ? /We do not use advertising or targeting cookies/ : /No utilizamos cookies de publicidad/);
    }
  });
});

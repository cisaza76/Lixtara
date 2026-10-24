import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// El módulo lee la configuración al cargar: estas pruebas usan un build CONFIGURADO (las dos
// variables), salvo la que verifica justamente lo contrario.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_GTM_ID = "GTM-ABC1234";
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_" + "a".repeat(40);
});
import {
  LISTING_STEP_SLUGS, disableAnalytics, enableAnalytics, listingErrorField, listingStepCompleteEvent, listingStepEvent,
  homePriceRange, markPageview, resultsBucket, resumeSourceFromMarker, track, trackThen,
} from "@/lib/analytics";
import {
  ADS_COOKIE_RE, ANALYTICS_COOKIE_RE, analyticsConfig, consentCookieValue, consentModeUpdate, consentTools,
  effectiveConsent, gpcEnabled,
  isAdsExcludedPath, isAnalyticsExcludedPath, isRecordingExcludedPath, needsFullLoad, readAdsConsent, readConsent,
  readConsentState,
  sanitizePosthogProperties, sanitizeUrl,
} from "@/lib/analytics-config";
import { recordServerEvent } from "@/lib/analytics.server";
import { t } from "@/lib/i18n";

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

  it("plan_tier from step 3 on (it's chosen in step 2)", () => {
    expect(listingStepEvent(2, "en", "pro")).not.toHaveProperty("plan_tier");
    expect(listingStepEvent(3, "en", "pro")).toMatchObject({ step_name: "details", plan_tier: "pro" });
    expect(listingStepEvent(4, "en", null)).not.toHaveProperty("plan_tier");
  });

  it("calculator: price range (the CMO's five values), never the exact value", () => {
    expect([200_000, 299_999, 300_000, 499_999, 500_000, 999_999, 1_000_000, 1_999_999, 2_000_000].map(homePriceRange)).toEqual([
      "under_300k", "under_300k", "300k_500k", "300k_500k", "500k_1m", "500k_1m", "1m_2m", "1m_2m", "2m_plus",
    ]);
  });

  it("listing_resumed source: email (seller's link), broker (broker's link), account (dashboard), else none", () => {
    expect(resumeSourceFromMarker("email_link")).toBe("email");
    expect(resumeSourceFromMarker("broker_link")).toBe("broker");
    expect(resumeSourceFromMarker("account")).toBe("account");
    expect(resumeSourceFromMarker("direct")).toBeNull();
    expect(resumeSourceFromMarker(null)).toBeNull();
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
    expect(pushed).toMatchObject({ ...begin, eventTimeout: 1200 });
    expect(done).not.toHaveBeenCalled();
    (pushed.eventCallback as () => void)();
    vi.advanceTimersByTime(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("si GTM nunca responde, redirige igual pasado el tiempo", () => {
    enableAnalytics(null);
    const done = vi.fn();
    trackThen(begin, done);
    vi.advanceTimersByTime(1499);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("track: nada sale sin consentimiento", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { location: { pathname: "/en" } };
    disableAnalytics();
    markPageview("/en");
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

  it("lee la elección de la cookie, por categoría", () => {
    expect(readConsentState("a=1; lx_consent=analytics-granted.ads-denied; b=2")).toEqual({ analytics: "granted", ads: "denied" });
    expect(readConsentState("lx_consent=analytics-denied.ads-granted")).toEqual({ analytics: "denied", ads: "granted" });
    expect(readConsent("lx_consent=analytics-granted.ads-granted")).toBe("granted");
    expect(readAdsConsent("lx_consent=analytics-granted.ads-granted")).toBe("granted");
    expect(readConsent("lx_consent=maybe")).toBeNull();
    expect(readConsentState("lx_consent=analytics-granted")).toBeNull();
    expect(readConsent("")).toBeNull();
    expect(readAdsConsent("")).toBeNull();
    for (const s of [
      { analytics: "granted", ads: "granted" },
      { analytics: "granted", ads: "denied" },
      { analytics: "denied", ads: "granted" },
      { analytics: "denied", ads: "denied" },
    ] as const) {
      expect(readConsentState(`lx_consent=${consentCookieValue(s)}`)).toEqual(s);
    }
  });

  it("valores de antes del 2026-10-24 (solo analítica): publicidad denegada, sin volver a preguntar", () => {
    expect(readConsentState("lx_consent=granted")).toEqual({ analytics: "granted", ads: "denied" });
    expect(readConsentState("lx_consent=denied")).toEqual({ analytics: "denied", ads: "denied" });
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
    fresh.markPageview("/en");
    fresh.track({ event: "loui_open", lang: "en" });
    expect((w.window as Window).dataLayer).toEqual([{ event: "loui_open", lang: "en" }]);
    // Si después apareciera un cliente, no recibe eventos viejos: no había nada retenido.
    const capture = vi.fn();
    fresh.enableAnalytics({ capture });
    expect(capture).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("Clarity: graba el embudo, nunca /account (se entra y se sale con carga completa)", () => {
  it("/account y /admin no se graban; el embudo y la autenticación sí", () => {
    for (const p of ["/en/account", "/es/account", "/es/account/x", "/en/admin", "/es/admin/seller-leads"]) {
      expect(isRecordingExcludedPath(p), p).toBe(true);
    }
    for (const p of ["/en", "/es/properties", "/en/listing/new", "/es/listing/continue", "/es/auth/verify",
      "/en/sign-in", "/es/sign-up", "/en/dashboard", "/en/accounting", "/en/accounts"]) {
      expect(isRecordingExcludedPath(p), p).toBe(false);
    }
  });
  it("entrar a /account siempre recarga; salir hacia el embudo recarga solo con consentimiento", () => {
    const none = { analytics: false, ads: false };
    const analytics = { analytics: true, ads: false };
    expect(needsFullLoad("/en/listing/new", "/en/account", none)).toBe(true);
    expect(needsFullLoad("/es/listing/new", "/es/account", analytics)).toBe(true);
    expect(needsFullLoad("/en/sign-in", "/en/account", none)).toBe(true);
    expect(needsFullLoad("/en/account", "/en/listing/new", analytics)).toBe(true);
    expect(needsFullLoad("/en/account", "/en/listing/new", none)).toBe(false);
    expect(needsFullLoad("/en/listing/new", "/en/dashboard", analytics)).toBe(false);
    expect(needsFullLoad("/en/account", "/en/account", analytics)).toBe(false);
  });
});

describe("publicidad: rutas sin publicidad y recarga al cruzarlas (2026-10-24)", () => {
  it("/listing, /account, /auth, /sign-in, /sign-up, /dashboard y /admin no llevan publicidad", () => {
    for (const p of ["/en/listing", "/es/listing/new", "/en/account", "/es/auth/verify", "/en/sign-in", "/es/sign-up",
      "/en/dashboard", "/es/dashboard/x", "/en/admin", "/es/admin/seller-leads"]) {
      expect(isAdsExcludedPath(p), p).toBe(true);
    }
    for (const p of ["/en", "/es", "/en/properties", "/es/owners", "/en/services", "/en/cookies", "/en/listings",
      "/en/accounting", "/en/sign-up-now"]) {
      expect(isAdsExcludedPath(p), p).toBe(false);
    }
  });

  it("con publicidad aceptada, entrar o salir de una ruta sin publicidad recarga; sin ella, no", () => {
    const ads = { analytics: false, ads: true };
    const none = { analytics: false, ads: false };
    expect(needsFullLoad("/en", "/en/listing/new", ads)).toBe(true);
    expect(needsFullLoad("/en/listing/new", "/en", ads)).toBe(true);
    expect(needsFullLoad("/es/sign-up", "/es/owners", ads)).toBe(true);
    expect(needsFullLoad("/en", "/en/properties", ads)).toBe(false);
    expect(needsFullLoad("/en/listing/new", "/en/dashboard", ads)).toBe(false);
    expect(needsFullLoad("/en", "/en/listing/new", none)).toBe(false);
    expect(needsFullLoad("/en/listing/new", "/en", none)).toBe(false);
  });
});

describe("consentimiento: lo que concede cada categoría y lo que se borra al rechazar", () => {
  it("aceptar Publicidad concede las 3 señales de publicidad; rechazarla las deja denegadas", () => {
    expect(consentModeUpdate({ analytics: "denied", ads: "granted" }, "/en")).toEqual({
      ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "denied",
    });
    expect(consentModeUpdate({ analytics: "granted", ads: "denied" }, "/en")).toEqual({
      ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted",
    });
    expect(consentModeUpdate({ analytics: "granted", ads: "granted" }, "/es/properties")).toEqual({
      ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted",
    });
  });

  it("en una ruta sin publicidad, las 3 señales quedan denegadas aunque se haya aceptado", () => {
    for (const p of ["/en/listing/new", "/es/account", "/en/sign-in", "/es/sign-up", "/en/auth/verify", "/en/dashboard"]) {
      expect(consentModeUpdate({ analytics: "granted", ads: "granted" }, p), p).toEqual({
        ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted",
      });
    }
  });

  it("Global Privacy Control: Publicidad denegada (las 3 señales); Analítica no cambia", () => {
    const all = { analytics: "granted", ads: "granted" } as const;
    expect(consentModeUpdate(all, "/en", true)).toEqual({
      ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted",
    });
    expect(consentModeUpdate({ analytics: "denied", ads: "granted" }, "/es/properties", true)).toEqual({
      ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied",
    });
    expect(effectiveConsent(all, true)).toEqual({ analytics: "granted", ads: "denied" });
    expect(effectiveConsent(all, false)).toEqual(all);
    expect(gpcEnabled({ globalPrivacyControl: true })).toBe(true);
    expect(gpcEnabled({ globalPrivacyControl: false })).toBe(false);
    expect(gpcEnabled({})).toBe(false);
    expect(gpcEnabled("1")).toBe(true);
    expect(gpcEnabled("0")).toBe(false);
    expect(gpcEnabled(null)).toBe(false);
  });

  it("el banner con GPC: Publicidad no se puede aceptar y lo dice en esa categoría", () => {
    const src = readFileSync(join(process.cwd(), "src/components/analytics-consent.tsx"), "utf8");
    expect(src).toContain("consentModeUpdate(choice, window.location.pathname, gpcEnabled(navigator))");
    expect(src).toContain('const blocked = c.key === "ads" && gpc;');
    expect(src).toContain("disabled={blocked}");
    expect(src).toContain("{props.labels.gpcNote}");
    expect(src).toContain("setConsent(effectiveConsent(draft, gpc))");
    expect(src).toContain("const state = effectiveConsent(");
    expect(t("es").cookieNotice.gpcNote).toBe("Tu navegador pidió no compartir datos para publicidad.");
    expect(t("en").cookieNotice.gpcNote).toBe("Your browser asked not to share data for advertising.");
    const guard = readFileSync(join(process.cwd(), "src/components/recording-guard.tsx"), "utf8");
    expect(guard).toContain('ads: s?.ads === "granted" && !gpcEnabled(navigator)');
  });

  it("el banner aplica la elección guardada antes de gtm.js, con lx_ads_consent para GTM", () => {
    const src = readFileSync(join(process.cwd(), "src/components/analytics-consent.tsx"), "utf8");
    const i = (s: string) => src.indexOf(s);
    expect(i('gtag("consent", "default"')).toBeGreaterThan(-1);
    expect(i('gtag("consent", "default"')).toBeLessThan(i('gtag("consent", "update", update)'));
    expect(i('gtag("consent", "update", update)')).toBeLessThan(i("lx_ads_consent: update.ad_storage"));
    expect(i("lx_ads_consent: update.ad_storage")).toBeLessThan(i('event: "gtm.js"'));
    // "Rechazar todo" con el mismo estilo que "Aceptar todo".
    expect(src).toMatch(/setConsent\(all\("denied"\)\)\} className=\{button\}/);
    expect(src).toMatch(/setConsent\(all\("granted"\)\)\} className=\{button\}/);
    // Por defecto, todo rechazado.
    expect(src).toContain('useState<ConsentState>({ analytics: "denied", ads: "denied" })');
  });

  it("al rechazar Analítica se borran GA4, Clarity, PostHog y lx_ft; al rechazar Publicidad, Google Ads y Meta", () => {
    for (const c of ["_ga", "_ga_ABC123", "_gid", "_clck", "_clsk", "ph_phc_x_posthog", "lx_ft"]) {
      expect(ANALYTICS_COOKIE_RE.test(c), c).toBe(true);
      expect(ADS_COOKIE_RE.test(c), c).toBe(false);
    }
    for (const c of ["_gcl_au", "_gcl_aw", "_fbp", "_fbc"]) {
      expect(ADS_COOKIE_RE.test(c), c).toBe(true);
      expect(ANALYTICS_COOKIE_RE.test(c), c).toBe(false);
    }
    for (const c of ["lx_consent", "sb-access-token", "NEXT_LOCALE", "gallery_view"]) {
      expect(ANALYTICS_COOKIE_RE.test(c), c).toBe(false);
      expect(ADS_COOKIE_RE.test(c), c).toBe(false);
    }
  });

  it("el banner nombra solo las herramientas configuradas", () => {
    const gtm = "GTM-ABC1234";
    const key = "phc_" + "a".repeat(40);
    expect(consentTools({ gtmId: gtm, posthogKey: null }, "en")).toBe(
      "Google Analytics and Microsoft Clarity, which records how pages are used with personal information hidden",
    );
    expect(consentTools({ gtmId: gtm, posthogKey: key }, "es")).toBe(
      "Google Analytics, PostHog y Microsoft Clarity, que graba cómo se usan las páginas con tu información personal oculta",
    );
    expect(consentTools({ gtmId: null, posthogKey: key }, "en")).toBe("PostHog");
  });

  it("el aviso con GTM dice exactamente el texto de la v4 (2026-10-24), en EN y ES", () => {
    const c = { gtmId: "GTM-5KGLHNL4", posthogKey: null };
    const msg = (lang: "en" | "es") => t(lang).cookieNotice.consentMessage.replace("{tools}", consentTools(c, lang));
    expect(msg("en")).toBe(
      "We use essential cookies to run the site. With your permission, we also use analytics cookies (Google Analytics and Microsoft Clarity, which records how pages are used with personal information hidden) to improve the site, and advertising cookies (Meta and Google Ads) to measure our campaigns and show you our ads. You can accept or reject each category.",
    );
    expect(msg("es")).toBe(
      "Usamos cookies esenciales para que el sitio funcione. Con tu permiso, también usamos cookies de analítica (Google Analytics y Microsoft Clarity, que graba cómo se usan las páginas con tu información personal oculta) para mejorar el sitio, y cookies de publicidad (Meta y Google Ads) para medir nuestras campañas y mostrarte nuestros anuncios. Puedes aceptar o rechazar cada categoría.",
    );
    // Sin GTM (solo PostHog) no hay publicidad: ni en el texto ni como categoría.
    for (const lang of ["en", "es"] as const) {
      expect(t(lang).cookieNotice.consentMessageAnalyticsOnly).not.toMatch(/Meta|Google Ads/);
    }
    const layout = readFileSync(join(process.cwd(), "src/app/[lang]/layout.tsx"), "utf8");
    expect(layout).toContain("ads: analytics.gtmId ? cookieCopy.categoryAds : null,");
    expect(t("es").cookieNotice.consentRejectAll).toBe("Rechazar todo");
    expect(t("en").cookieNotice.consentRejectAll).toBe("Reject all");
    expect(t("en").cookieNotice.learnMore).toBe("Cookie Policy");
    expect(t("es").cookieNotice.learnMore).toBe("Política de cookies");
    for (const lang of ["en", "es"] as const) expect(msg(lang)).not.toMatch(/!|\p{Extended_Pictographic}/u);
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
    // Espera al lx_page_view de la ruta; el banner lo empuja y luego llama markPageview.
    expect((w.window as Window).dataLayer).toBeUndefined();
    (w.window as Window).dataLayer = [{ event: "lx_page_view", page_path: "/en/properties" }];
    fresh.markPageview("/en/properties");
    expect((w.window as Window).dataLayer).toEqual([
      { event: "lx_page_view", page_path: "/en/properties" },
      { event: "loui_open", lang: "en" },
    ]);
    const capture = vi.fn();
    fresh.enableAnalytics({ capture });
    expect(capture).toHaveBeenCalledWith("loui_open", { lang: "en" });
  });

  it("lx_page_view sale antes que listing_step_view; si nunca llega, el evento sale igual a los 3 s", async () => {
    configured();
    vi.useFakeTimers();
    vi.resetModules();
    const fresh = await import("@/lib/analytics");
    page("/es/listing/new", "lx_consent=granted");
    fresh.track(fresh.listingStepEvent(1, "es"));
    expect((w.window as Window).dataLayer).toBeUndefined();
    vi.advanceTimersByTime(3000);
    expect((w.window as Window).dataLayer).toEqual([fresh.listingStepEvent(1, "es")]);
    // Ruta nueva (navegación sin recarga): vuelve a esperar a su page_view.
    page("/es/account", "lx_consent=granted");
    fresh.track({ event: "loui_open", lang: "es" });
    expect((w.window as Window).dataLayer).toBeUndefined();
    fresh.markPageview("/es/account");
    expect((w.window as Window).dataLayer).toEqual([{ event: "loui_open", lang: "es" }]);
    vi.useRealTimers();
  });

  it("si se retira el consentimiento mientras espera, lo retenido se descarta", async () => {
    configured();
    vi.resetModules();
    const fresh = await import("@/lib/analytics");
    page("/en", "lx_consent=granted");
    fresh.track({ event: "loui_open", lang: "en" });
    fresh.disableAnalytics();
    fresh.markPageview("/en");
    expect((w.window as Window).dataLayer).toBeUndefined();
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

  it("nombra exactamente lo que el sitio carga: GA4, Clarity, Meta y Google Ads con GTM; PostHog con su variable", async () => {
    const { cookiesDoc, cookiesDocFor } = await import("@/lib/legal/cookies");
    const noAds = { en: /We do not use advertising or targeting cookies/, es: /No utilizamos cookies de publicidad/ };
    for (const lang of ["en", "es"] as const) {
      const ambos = JSON.stringify(cookiesDocFor(lang, { gtm: true, posthog: true }));
      expect(ambos).toMatch(/Google Analytics 4/);
      expect(ambos).toMatch(/Microsoft Clarity/);
      expect(ambos).toMatch(/PostHog/);

      const soloGtm = JSON.stringify(cookiesDocFor(lang, { gtm: true, posthog: false }));
      expect(soloGtm).not.toMatch(/PostHog/);

      const soloPosthog = JSON.stringify(cookiesDocFor(lang, { gtm: false, posthog: true }));
      expect(soloPosthog).toMatch(/PostHog/);
      for (const ausente of [/Google Analytics/, /Clarity/]) expect(soloPosthog).not.toMatch(ausente);

      // Con GTM: categoría Publicidad con sus cuatro cookies. Sin GTM: sin publicidad.
      for (const doc of [ambos, soloGtm]) {
        for (const c of ["_fbp", "_fbc", "_gcl_au", "_gcl_aw", "Meta Platforms, Inc.", "Google LLC (Google Ads)"]) {
          expect(doc, c).toContain(c);
        }
        expect(doc).not.toMatch(noAds[lang]);
      }
      for (const doc of [soloPosthog, JSON.stringify(cookiesDoc[lang])]) {
        expect(doc).not.toMatch(/Google Ads|Meta Platforms|_gcl_au|_fbp/);
        expect(doc).toMatch(noAds[lang]);
      }
      // Sentry declarado como herramienta técnica, en todas las variantes.
      for (const doc of [ambos, soloGtm, soloPosthog, JSON.stringify(cookiesDoc[lang])]) {
        expect(doc).toMatch(/Sentry \(Functional Software, Inc\.\)/);
      }
    }
  });
});

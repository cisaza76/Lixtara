import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  campaignFields,
  isHumanPageView,
  firstTouchCookieValue,
  nextFirstTouchCookie,
  parseFirstTouchClickIds,
  funnelIsTest,
  parseFirstTouch,
  sanitizeFunnelMetadata,
} from "@/lib/funnel-events";

describe("funnelIsTest", () => {
  const real = { vercelEnv: "production", propertyIsTest: false } as const;

  it("solo es real en Production, con propiedad real y sin modo de prueba de Stripe", () => {
    expect(funnelIsTest(real)).toBe(false);
    expect(funnelIsTest({ ...real, livemode: true })).toBe(false);
  });
  it("Preview, desarrollo o sin VERCEL_ENV = prueba (comparten la base de producción)", () => {
    for (const vercelEnv of ["preview", "development", undefined, ""]) {
      expect(funnelIsTest({ ...real, vercelEnv }), String(vercelEnv)).toBe(true);
    }
  });
  it("propiedad is_test, o desconocida, = prueba", () => {
    expect(funnelIsTest({ ...real, propertyIsTest: true })).toBe(true);
    expect(funnelIsTest({ ...real, propertyIsTest: null })).toBe(true);
  });
  it("Stripe livemode=false = prueba, aun en Production", () => {
    expect(funnelIsTest({ ...real, livemode: false })).toBe(true);
  });
});

describe("sanitizeFunnelMetadata", () => {
  it("deja claves conocidas con valores de forma cerrada", () => {
    expect(
      sanitizeFunnelMetadata({ lang: "es", plan_tier: "Pro", photos_count: 12, amount: 495, source: "email_link" }),
    ).toEqual({ lang: "es", plan_tier: "pro", photos_count: 12, amount: 495, source: "email_link" });
  });
  it("descarta claves desconocidas y todo lo que pueda ser un dato personal", () => {
    expect(
      sanitizeFunnelMetadata({
        email: "a@b.com",
        utm_source: "ana@gmail.com",
        utm_campaign: "123 Main St",
        utm_medium: "x".repeat(65),
        amount: Number.NaN,
        property_id: "p1",
      }),
    ).toEqual({});
  });
});

describe("UTM de primer contacto", () => {
  it("guarda source|medium|campaign saneados", () => {
    const v = firstTouchCookieValue(new URLSearchParams("utm_source=Google&utm_medium=cpc&utm_campaign=FSBO Miami"));
    expect(v).toBe("google|cpc|fsbo_miami");
    expect(parseFirstTouch(v ?? undefined)).toEqual({ utm_source: "google", utm_medium: "cpc", utm_campaign: "fsbo_miami" });
  });
  it("sin UTM no hay cookie; partes inválidas quedan vacías", () => {
    expect(firstTouchCookieValue(new URLSearchParams("q=1"))).toBeNull();
    expect(firstTouchCookieValue(new URLSearchParams("utm_source=a@b.com&utm_medium=email"))).toBe("|email|");
    expect(parseFirstTouch("|email|")).toEqual({ utm_medium: "email" });
    expect(parseFirstTouch(undefined)).toEqual({});
    expect(parseFirstTouch("x@y.com|<script>|")).toEqual({});
  });
});

describe("campaña en lx_page_view (UTM de Instantly)", () => {
  it("los UTM como campos de campaña de GA4, saneados", () => {
    const p = new URLSearchParams("utm_source=Instantly&utm_medium=email&utm_campaign=FL Owners Oct");
    expect(campaignFields(p)).toEqual({ campaign_source: "instantly", campaign_medium: "email", campaign_name: "fl_owners_oct" });
  });
  it("sin UTM, nada; un valor con forma de correo se descarta", () => {
    expect(campaignFields(new URLSearchParams("q=1"))).toEqual({});
    expect(campaignFields(new URLSearchParams("utm_source=instantly&utm_campaign=juan@x.com"))).toEqual({ campaign_source: "instantly" });
  });
});

describe("visitas de navegadores reales (owners_landing_view)", () => {
  const chrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  it("cuenta un navegador", () => {
    expect(isHumanPageView({ userAgent: chrome, purpose: null })).toBe(true);
  });
  it("no cuenta bots, escáneres de correo, clientes HTTP, prefetch ni peticiones sin user-agent", () => {
    for (const ua of ["Googlebot/2.1", "Mozilla/5.0 (compatible; Microsoft Safe Links)", "curl/8.4.0", "python-requests/2.31", "Mimecast URL scanner", "HeadlessChrome/120"]) {
      expect(isHumanPageView({ userAgent: ua, purpose: null }), ua).toBe(false);
    }
    expect(isHumanPageView({ userAgent: null, purpose: null })).toBe(false);
    expect(isHumanPageView({ userAgent: chrome, purpose: "prefetch" })).toBe(false);
  });
});

describe("lx_ft: UTM con Analítica, gclid/gbraid/wbraid con Publicidad", () => {
  const landing = new URLSearchParams("utm_source=google&utm_medium=cpc&gclid=Cj0K_abc-1&gbraid=0AAA_gb&wbraid=Cl_wb");
  const both = { analytics: "granted", ads: "granted" } as const;
  it("con las dos aceptadas: todo, de la URL de llegada", () => {
    const v = nextFirstTouchCookie(null, landing, both);
    expect(v).toBe("google|cpc||Cj0K_abc-1|0AAA_gb|Cl_wb");
    expect(parseFirstTouchClickIds(v)).toEqual({ gclid: "Cj0K_abc-1", gbraid: "0AAA_gb", wbraid: "Cl_wb" });
    expect(parseFirstTouch(v ?? undefined)).toEqual({ utm_source: "google", utm_medium: "cpc" });
  });
  it("solo Analítica: sin identificadores de clic; solo Publicidad: sin UTM", () => {
    expect(nextFirstTouchCookie(null, landing, { analytics: "granted", ads: "denied" })).toBe("google|cpc|");
    expect(nextFirstTouchCookie(null, landing, { analytics: "denied", ads: "granted" })).toBe("|||Cj0K_abc-1|0AAA_gb|Cl_wb");
  });
  it("Publicidad denegada (o GPC) después: se borran los identificadores; las dos denegadas: la cookie", () => {
    const v = nextFirstTouchCookie(null, landing, both);
    expect(nextFirstTouchCookie(v, new URLSearchParams(), { analytics: "granted", ads: "denied" })).toBe("google|cpc|");
    expect(nextFirstTouchCookie(v, new URLSearchParams(), { analytics: "denied", ads: "denied" })).toBeNull();
  });
  it("primer contacto: lo guardado no se sobrescribe; lo que falta se completa", () => {
    const v = nextFirstTouchCookie("google|cpc||Cj0K_old||", new URLSearchParams("utm_source=fb&gclid=NEW&wbraid=W1"), both);
    expect(v).toBe("google|cpc||Cj0K_old||W1");
  });
  it("valores raros no entran; sin nada, no hay cookie", () => {
    expect(nextFirstTouchCookie(null, new URLSearchParams("gclid=<script>&gbraid=a b"), both)).toBeNull();
    expect(nextFirstTouchCookie(null, new URLSearchParams("q=1"), both)).toBeNull();
    expect(parseFirstTouchClickIds("a|b|c|x;y||")).toEqual({});
    expect(parseFirstTouchClickIds(undefined)).toEqual({});
  });
});

// Regla del owner (2026-11-05): lx_ft es first-party. La exclusión de publicidad en el embudo,
// la cuenta y el acceso (isAdsExcludedPath) aplica solo a GTM y al píxel; los IDs de clic de un
// anuncio que lleva directo a /es/listing/new se guardan si la elección de la persona tiene
// Publicidad aceptada (guardada o aceptada en el banner de esa ruta). Comprobado en el preview
// el 2026-11-05; este test fija la regla.
describe("lx_ft: gclid/gbraid/wbraid al llegar directo a una ruta sin publicidad", () => {
  const landing = new URLSearchParams("gclid=TESTgclidA1");

  it("la ruta excluye la publicidad de GTM, pero el banner y lx_ft siguen corriendo ahí", async () => {
    const { isAdsExcludedPath, isAnalyticsExcludedPath } = await import("@/lib/analytics-config");
    for (const p of ["/es/listing/new", "/en/listing/new"]) {
      expect(isAdsExcludedPath(p), p).toBe(true);
      expect(isAnalyticsExcludedPath(p), p).toBe(false);
    }
  });

  it("con Publicidad aceptada (sin GPC) guarda el gclid; con GPC o Publicidad rechazada, no", async () => {
    const { effectiveConsent } = await import("@/lib/analytics-config");
    const accepted = effectiveConsent({ analytics: "denied", ads: "granted" }, false);
    expect(nextFirstTouchCookie(null, landing, accepted)).toContain("TESTgclidA1");
    expect(nextFirstTouchCookie(null, landing, effectiveConsent({ analytics: "denied", ads: "granted" }, true)) ?? "").not.toContain("TESTgclidA1");
    expect(nextFirstTouchCookie(null, landing, { analytics: "granted", ads: "denied" }) ?? "").not.toContain("TESTgclidA1");
  });

  it("el banner pasa a lx_ft la elección de la persona (con GPC), no el estado forzado de la ruta", () => {
    const src = readFileSync(join(process.cwd(), "src/components/analytics-consent.tsx"), "utf8");
    const effect = src.slice(src.indexOf("// Efectos de la elección"), src.indexOf("syncFirstTouch(state);") + 30);
    expect(effect).toContain("const state = effectiveConsent({ analytics, ads: props.gtmId ? ads : \"denied\" }, gpc);");
    expect(effect).toContain("syncFirstTouch(state);");
    // Solo /admin (isAnalyticsExcludedPath) corta el efecto; la exclusión de publicidad no entra.
    expect(effect).not.toMatch(/isAdsExcludedPath|adsExcluded|forced/);
  });
});

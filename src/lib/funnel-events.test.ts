import { describe, expect, it } from "vitest";
import {
  campaignFields,
  isHumanPageView,
  firstTouchCookieValue,
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

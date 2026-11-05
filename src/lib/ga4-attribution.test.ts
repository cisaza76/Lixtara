import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkoutAttribution,
  gaClientId,
  gaSessionId,
  googleGclid,
  googleGbraid,
  metaFbc,
  metaFbp,
  purchaseItem,
  purchasePayload,
  purchaseSendMode,
} from "@/lib/ga4-attribution";

const MID = "G-70H5Q9530F";
const ADS = "_fbp=fb.1.1760000000000.1234567890; _fbc=fb.1.1760000000000.IwAR2abc_DEF-123; _gcl_aw=GCL.1760000000.Cj0KCQjw_abc-123; _gcl_gb=GCL.1760000000.0AAAAAo_gbraid-1";
const cookies = (consent: string) =>
  `lx_consent=${consent}; _ga=GA1.1.1234567890.1760000000; _ga_70H5Q9530F=GS2.1.s1760400000$o3$g1$t1760400500$j0$l0$h0; ${ADS}`;

describe("metadata del Checkout", () => {
  it("analítica sin publicidad: ids de GA4; nada de Meta ni gclid", () => {
    for (const v of ["granted", "analytics-granted.ads-denied"]) {
      expect(checkoutAttribution(cookies(v), MID, "es")).toEqual({
        lang: "es",
        consent: "granted",
        ads_consent: "denied",
        ga_client_id: "1234567890.1760000000",
        ga_session_id: "1760400000",
      });
    }
  });
  it("con Publicidad aceptada: _fbp, _fbc, gclid y gbraid", () => {
    expect(checkoutAttribution(cookies("analytics-granted.ads-granted"), MID, "en")).toEqual({
      lang: "en",
      consent: "granted",
      ads_consent: "granted",
      ga_client_id: "1234567890.1760000000",
      ga_session_id: "1760400000",
      fbp: "fb.1.1760000000000.1234567890",
      fbc: "fb.1.1760000000000.IwAR2abc_DEF-123",
      gclid: "Cj0KCQjw_abc-123",
      gbraid: "0AAAAAo_gbraid-1",
    });
    // Publicidad sí, analítica no: solo los de publicidad.
    expect(checkoutAttribution(cookies("analytics-denied.ads-granted"), MID, "en")).toEqual({
      lang: "en",
      consent: "denied",
      ads_consent: "granted",
      fbp: "fb.1.1760000000000.1234567890",
      fbc: "fb.1.1760000000000.IwAR2abc_DEF-123",
      gclid: "Cj0KCQjw_abc-123",
      gbraid: "0AAAAAo_gbraid-1",
    });
  });
  it("Global Privacy Control (Sec-GPC: 1): Publicidad denegada, sin _fbp, _fbc ni gclid; GA4 sigue", () => {
    expect(checkoutAttribution(cookies("analytics-granted.ads-granted"), MID, "en", true)).toEqual({
      lang: "en",
      consent: "granted",
      ads_consent: "denied",
      ga_client_id: "1234567890.1760000000",
      ga_session_id: "1760400000",
    });
    for (const f of ["tier", "photography", "consultation", "staging-overage"]) {
      const src = readFileSync(`src/app/api/checkout/${f}/route.ts`, "utf8");
      expect(src, f).toContain('gpcEnabled(req.headers.get("sec-gpc"))');
    }
  });
  it("sin consentimiento: solo idioma y estado, sin ids", () => {
    expect(checkoutAttribution(cookies("denied"), MID, "en")).toEqual({ lang: "en", consent: "denied", ads_consent: "denied" });
    expect(checkoutAttribution(cookies("analytics-denied.ads-denied"), MID, "en")).toEqual({
      lang: "en", consent: "denied", ads_consent: "denied",
    });
    expect(checkoutAttribution(`_ga=GA1.1.1.2; ${ADS}`, MID, "fr")).toEqual({ lang: "en", consent: "unknown", ads_consent: "unknown" });
    expect(checkoutAttribution(null, MID, "en")).toEqual({ lang: "en", consent: "unknown", ads_consent: "unknown" });
  });
  it("formatos de Meta y Google Ads: un valor raro no entra en la metadata", () => {
    expect(metaFbp("fb.1.1760000000000.123")).toBe("fb.1.1760000000000.123");
    expect(metaFbp("fb.1.x.123")).toBeNull();
    expect(metaFbp("<script>")).toBeNull();
    expect(metaFbc("fb.1.1760000000000.abc def")).toBeNull();
    expect(googleGclid("GCL.1760000000.abc")).toBe("abc");
    expect(googleGclid("GCL.1.x;y")).toBeNull();
    expect(googleGclid(null)).toBeNull();
    expect(googleGbraid("GCL.1760000000.0AAAAAo_x")).toBe("0AAAAAo_x");
    expect(googleGbraid("0AAAAAo_x")).toBeNull();
  });
  it("gclid/gbraid/wbraid: primero lx_ft (URL de llegada), de respaldo _gcl_aw/_gcl_gb; wbraid solo de lx_ft", () => {
    const ft = "lx_ft=google|cpc||FT_gclid|FT_gbraid|FT_wbraid";
    const ads = "lx_consent=analytics-denied.ads-granted";
    expect(checkoutAttribution(`${ads}; ${ft}; ${ADS}`, MID, "en")).toMatchObject({
      gclid: "FT_gclid", gbraid: "FT_gbraid", wbraid: "FT_wbraid",
    });
    // Sin lx_ft: las cookies de Google; sin wbraid.
    const fallback = checkoutAttribution(`${ads}; ${ADS}`, MID, "en");
    expect(fallback).toMatchObject({ gclid: "Cj0KCQjw_abc-123", gbraid: "0AAAAAo_gbraid-1" });
    expect(fallback).not.toHaveProperty("wbraid");
    // lx_ft solo con wbraid: gclid y gbraid siguen saliendo de las cookies.
    expect(checkoutAttribution(`${ads}; lx_ft=|||||FT_w; ${ADS}`, MID, "en")).toMatchObject({
      gclid: "Cj0KCQjw_abc-123", gbraid: "0AAAAAo_gbraid-1", wbraid: "FT_w",
    });
  });
  it("con Publicidad denegada o GPC, ningún identificador de clic aunque lx_ft los tenga", () => {
    const ft = "lx_ft=|||FT_gclid|FT_gbraid|FT_wbraid";
    for (const [c, gpc] of [["analytics-granted.ads-denied", false], ["analytics-granted.ads-granted", true]] as const) {
      const out = checkoutAttribution(`lx_consent=${c}; ${ft}; ${ADS}`, MID, "en", gpc);
      for (const k of ["gclid", "gbraid", "wbraid", "fbp", "fbc"]) expect(out, `${c} ${gpc} ${k}`).not.toHaveProperty(k);
    }
  });
  it("sin measurement id no hay session_id (no sabe qué cookie leer)", () => {
    expect(checkoutAttribution(cookies("granted"), undefined, "en")).not.toHaveProperty("ga_session_id");
  });
  it("formatos de cookie de GA4", () => {
    expect(gaClientId("GA1.2.111.222")).toBe("111.222");
    expect(gaClientId("GA1.1.abc.222")).toBeNull();
    expect(gaSessionId("GS1.1.1760400000.3.1.1760400500.0.0.0")).toBe("1760400000");
    expect(gaSessionId("GS2.1.s1760400000$o3")).toBe("1760400000");
    expect(gaSessionId("garbage")).toBeNull();
  });
});

describe("purchase", () => {
  it("producto por la metadata: plan o servicio", () => {
    expect(purchaseItem({ tier: "pro", property_id: "p" })).toEqual({ item_id: "pro", item_category: "plan" });
    expect(purchaseItem({ kind: "consultation" })).toEqual({ item_id: "consultation", item_category: "service" });
    expect(purchaseItem({ kind: "photography" })?.item_id).toBe("photography");
    expect(purchaseItem({ kind: "staging_overage" })?.item_id).toBe("staging");
    expect(purchaseItem({ tier: "gold" })).toBeNull();
  });

  const ok = {
    vercelEnv: "production", livemode: true, consent: "granted", clientId: "1.2", propertyIsTest: false, hasConfig: true,
  };
  it("Production: sale solo si se cumple todo (sin cambios)", () => {
    expect(purchaseSendMode(ok)).toBe("live");
    expect(purchaseSendMode({ ...ok, livemode: false })).toBeNull();
    expect(purchaseSendMode({ ...ok, consent: "denied" })).toBeNull();
    expect(purchaseSendMode({ ...ok, consent: undefined })).toBeNull();
    expect(purchaseSendMode({ ...ok, clientId: undefined })).toBeNull();
    expect(purchaseSendMode({ ...ok, propertyIsTest: true })).toBeNull();
    expect(purchaseSendMode({ ...ok, propertyIsTest: null })).toBeNull();
    expect(purchaseSendMode({ ...ok, hasConfig: false })).toBeNull();
  });
  it("Preview: solo compras de prueba (Stripe test o is_test), en modo debug; nunca una compra real", () => {
    const pv = { ...ok, vercelEnv: "preview" };
    expect(purchaseSendMode({ ...pv, livemode: false })).toBe("debug");
    expect(purchaseSendMode({ ...pv, propertyIsTest: true })).toBe("debug");
    // Consulta o staging sin listing, con Stripe en modo de prueba.
    expect(purchaseSendMode({ ...pv, livemode: false, propertyIsTest: false })).toBe("debug");
    expect(purchaseSendMode(pv)).toBeNull();
    expect(purchaseSendMode({ ...pv, livemode: false, consent: "denied" })).toBeNull();
    expect(purchaseSendMode({ ...pv, livemode: false, hasConfig: false })).toBeNull();
    expect(purchaseSendMode({ ...ok, vercelEnv: "development", livemode: false })).toBeNull();
    expect(purchaseSendMode({ ...ok, vercelEnv: undefined, livemode: false })).toBeNull();
  });
  it("payload: debug_mode: 1 solo en modo debug", () => {
    const base = { clientId: "1.2", adsConsent: "denied", transactionId: "cs_test_x", value: 495, currency: "usd",
      item: { item_id: "pro", item_category: "plan" as const } };
    expect(purchasePayload({ ...base, debugMode: true }).events[0].params).toMatchObject({ debug_mode: 1 });
    expect(purchasePayload(base).events[0].params).not.toHaveProperty("debug_mode");
  });

  it("payload: las señales de publicidad según Publicidad aceptada al pagar", () => {
    const base = { clientId: "1.2", transactionId: "cs_live_x", value: 495, currency: "usd",
      item: { item_id: "pro", item_category: "plan" as const } };
    expect(purchasePayload({ ...base, adsConsent: "granted" }).consent).toEqual({ ad_user_data: "GRANTED", ad_personalization: "GRANTED" });
    expect(purchasePayload({ ...base, adsConsent: "denied" }).consent).toEqual({ ad_user_data: "DENIED", ad_personalization: "DENIED" });
    expect(purchasePayload({ ...base, adsConsent: undefined }).consent).toEqual({ ad_user_data: "DENIED", ad_personalization: "DENIED" });
  });

  it("payload: transaction_id = sesión de Stripe, valor, moneda e item", () => {
    const p = purchasePayload({
      clientId: "1.2", adsConsent: "denied", sessionId: "99", transactionId: "cs_live_x", value: 495, currency: "usd",
      item: { item_id: "pro", item_category: "plan" },
    });
    expect(p.client_id).toBe("1.2");
    expect(p.events[0]).toMatchObject({
      name: "purchase",
      params: { transaction_id: "cs_live_x", value: 495, currency: "USD", session_id: "99",
        items: [{ item_id: "pro", item_category: "plan", price: 495, quantity: 1 }] },
    });
  });
});

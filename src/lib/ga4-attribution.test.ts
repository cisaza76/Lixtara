import { describe, expect, it } from "vitest";
import {
  checkoutAttribution,
  gaClientId,
  gaSessionId,
  googleGclid,
  metaFbc,
  metaFbp,
  purchaseItem,
  purchasePayload,
  shouldSendPurchase,
} from "@/lib/ga4-attribution";

const MID = "G-70H5Q9530F";
const ADS = "_fbp=fb.1.1760000000000.1234567890; _fbc=fb.1.1760000000000.IwAR2abc_DEF-123; _gcl_aw=GCL.1760000000.Cj0KCQjw_abc-123";
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
  it("con Publicidad aceptada: _fbp, _fbc y gclid", () => {
    expect(checkoutAttribution(cookies("analytics-granted.ads-granted"), MID, "en")).toEqual({
      lang: "en",
      consent: "granted",
      ads_consent: "granted",
      ga_client_id: "1234567890.1760000000",
      ga_session_id: "1760400000",
      fbp: "fb.1.1760000000000.1234567890",
      fbc: "fb.1.1760000000000.IwAR2abc_DEF-123",
      gclid: "Cj0KCQjw_abc-123",
    });
    // Publicidad sí, analítica no: solo los de publicidad.
    expect(checkoutAttribution(cookies("analytics-denied.ads-granted"), MID, "en")).toEqual({
      lang: "en",
      consent: "denied",
      ads_consent: "granted",
      fbp: "fb.1.1760000000000.1234567890",
      fbc: "fb.1.1760000000000.IwAR2abc_DEF-123",
      gclid: "Cj0KCQjw_abc-123",
    });
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
  it("sale solo si se cumple todo", () => {
    expect(shouldSendPurchase(ok)).toBe(true);
    expect(shouldSendPurchase({ ...ok, livemode: false })).toBe(false);
    expect(shouldSendPurchase({ ...ok, vercelEnv: "preview" })).toBe(false);
    expect(shouldSendPurchase({ ...ok, consent: "denied" })).toBe(false);
    expect(shouldSendPurchase({ ...ok, consent: undefined })).toBe(false);
    expect(shouldSendPurchase({ ...ok, clientId: undefined })).toBe(false);
    expect(shouldSendPurchase({ ...ok, propertyIsTest: true })).toBe(false);
    expect(shouldSendPurchase({ ...ok, propertyIsTest: null })).toBe(false);
    expect(shouldSendPurchase({ ...ok, hasConfig: false })).toBe(false);
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

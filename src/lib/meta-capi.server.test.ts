import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Supabase simulado: properties y ad_attribution por id; el correo del dueño por auth.admin.
const db = vi.hoisted(() => ({
  property: { is_test: false, owner_id: "owner-1", pricing_tier: "pro" } as Record<string, unknown> | null,
  attribution: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/supabase/service", () => ({
  createService: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === "properties" ? db.property : db.attribution }),
        upsert: async (row: Record<string, unknown>) => {
          db.upserts.push(row);
          return { error: null };
        },
      };
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "Owner@Example.com" } } }) } },
  }),
}));
vi.mock("@/lib/email-recipient-lang", () => ({ lookupRecipientLang: async () => "es" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { metaCompleteRegistration, metaLeadOnEmailVerified, metaPurchase, saveAdAttribution } from "@/lib/meta-capi.server";

const FBP = "fb.1.1730000000000.1234567890";
const granted = { ads: "granted", fbp: FBP, fbc: null, clientIp: "203.0.113.10", clientUa: "UA" } as const;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
const sent = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

function session(md: Record<string, string>, livemode = true): Stripe.Checkout.Session {
  return {
    id: "cs_test_1",
    livemode,
    amount_total: 49500,
    currency: "usd",
    customer_details: { email: "owner@example.com" },
    metadata: { property_id: "prop-1", user_id: "owner-1", tier: "pro", lang: "es", ...md },
  } as unknown as Stripe.Checkout.Session;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("META_CAPI_ENABLED", "true");
  vi.stubEnv("META_CAPI_TOKEN", "tok_secret");
  vi.stubEnv("META_DATASET_ID", "958509363984889");
  vi.stubEnv("META_TEST_EVENT_CODE", "");
  vi.stubEnv("VERCEL_ENV", "production");
  db.property = { is_test: false, owner_id: "owner-1", pricing_tier: "pro" };
  db.attribution = { ads_consent: "granted", fbp: FBP, fbc: null, client_ip: "203.0.113.10", client_ua: "UA" };
  db.upserts = [];
  fetchMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Lead", () => {
  it("con Publicidad aceptada: guarda y envía al conjunto de datos, token en el cuerpo", async () => {
    await metaLeadOnEmailVerified({ userId: "owner-1", email: "owner@example.com", propertyId: "prop-1", lang: "en", ids: granted });
    expect(db.upserts[0]).toMatchObject({ user_id: "owner-1", ads_consent: "granted", fbp: FBP, client_ip: "203.0.113.10" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://graph.facebook.com/v26.0/958509363984889/events");
    const body = sent()[0];
    expect(body.access_token).toBe("tok_secret");
    expect(body.test_event_code).toBeUndefined();
    expect(body.data[0]).toMatchObject({ event_name: "Lead", event_id: "lead_owner-1", custom_data: { content_name: "listing_registration", lang: "en" } });
  });
  it("con Publicidad rechazada: borra lo guardado y no envía", async () => {
    await metaLeadOnEmailVerified({ userId: "owner-1", email: "o@x.co", propertyId: "prop-1", lang: "en", ids: { ads: "denied" } });
    expect(db.upserts[0]).toMatchObject({ ads_consent: "denied", fbp: null, fbc: null, client_ip: null, client_ua: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sin elección en la cookie: no guarda ni envía", async () => {
    await saveAdAttribution("owner-1", { ads: "unknown" });
    await metaLeadOnEmailVerified({ userId: "owner-1", email: "o@x.co", propertyId: "prop-1", lang: "en", ids: { ads: "unknown" } });
    expect(db.upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("apagada (sin META_CAPI_ENABLED): guarda, pero no envía", async () => {
    vi.stubEnv("META_CAPI_ENABLED", "");
    await metaLeadOnEmailVerified({ userId: "owner-1", email: "o@x.co", propertyId: "prop-1", lang: "en", ids: granted });
    expect(db.upserts).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CompleteRegistration", () => {
  it("con lo guardado del vendedor principal, su correo cifrado y el plan", async () => {
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: "2026-11-09T15:00:00Z" });
    const ev = sent()[0].data[0];
    expect(ev).toMatchObject({
      event_name: "CompleteRegistration",
      event_id: "agreement_prop-1",
      event_time: Date.UTC(2026, 10, 9, 15) / 1000,
      custom_data: { content_name: "listing_agreement", plan_tier: "pro", lang: "es" },
    });
    expect(ev.event_source_url).toMatch(/\/es\/listing\/new$/);
    expect(ev.user_data.client_ip_address).toBe("203.0.113.10");
    expect(JSON.stringify(ev)).not.toMatch(/owner@example\.com/i);
  });
  it("lo guardado dice denied (retiró la Publicidad o GPC): no sale", async () => {
    db.attribution = { ads_consent: "denied", fbp: null, fbc: null, client_ip: null, client_ua: null };
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("listing is_test en Production: no sale", async () => {
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Purchase", () => {
  it("pago confirmado con Publicidad aceptada al abrir el Checkout: purchase_<listing>, valor en USD", async () => {
    await metaPurchase(session({ ads_consent: "granted", fbp: FBP }));
    const ev = sent()[0].data[0];
    expect(ev).toMatchObject({
      event_name: "Purchase",
      event_id: "purchase_prop-1",
      custom_data: { value: 495, currency: "USD", content_type: "product", content_ids: ["pro"], lang: "es" },
    });
    expect(ev.user_data).toMatchObject({ fbp: FBP, client_ip_address: "203.0.113.10", client_user_agent: "UA" });
  });
  it("Publicidad no aceptada al abrir el Checkout: no sale", async () => {
    await metaPurchase(session({ ads_consent: "denied" }));
    await metaPurchase(session({ ads_consent: "unknown" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Stripe en modo prueba, en Production: no sale", async () => {
    await metaPurchase(session({ ads_consent: "granted" }, false));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Preview con código de prueba: sale con test_event_code (también is_test y pago de prueba)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST123");
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    await metaPurchase(session({ ads_consent: "granted" }, false));
    expect(sent()[0].test_event_code).toBe("TEST123");
  });
  it("Meta responde 500: un reintento y nunca lanza; 400: sin reintento", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const p = metaPurchase(session({ ads_consent: "granted" }));
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    await metaPurchase(session({ ads_consent: "granted" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

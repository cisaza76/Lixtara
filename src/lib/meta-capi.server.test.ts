import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Supabase simulado: properties y ad_attribution por id; el correo del dueño por auth.admin.
const db = vi.hoisted(() => ({
  property: { is_test: false, owner_id: "owner-1", pricing_tier: "pro" } as Record<string, unknown> | null,
  attribution: null as Record<string, unknown> | null,
  upserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  purged: [] as { user_id: string }[],
  agreement: null as Record<string, unknown> | null,
  payment: null as Record<string, unknown> | null,
}));
const jar = vi.hoisted(() => ({ value: null as string | null, reads: 0, throws: false, header: "" }));
const afterQueue = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterQueue.push(fn) }));
vi.mock("@/lib/supabase/service", () => ({
  createService: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const rows: Record<string, unknown> = { properties: db.property, agreements: db.agreement, payments: db.payment };
          return { data: table in rows ? rows[table] : db.attribution };
        },
        upsert: async (row: Record<string, unknown>) => {
          db.upserts.push(row);
          return { error: null };
        },
        update: (row: Record<string, unknown>) => {
          db.updates.push(row);
          return q;
        },
        lt: () => q,
        or: () => q,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: db.purged, error: null }),
      };
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "Owner@Example.com" } } }) } },
  }),
}));
vi.mock("@/lib/email-recipient-lang", () => ({ lookupRecipientLang: async () => "es" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: jar.header, "x-forwarded-for": "203.0.113.20", "user-agent": "UA2" }),
  cookies: async () => {
    jar.reads++;
    if (jar.throws) throw new Error("outside a request scope");
    return { get: (name: string) => (name === "lx_meta_test" && jar.value ? { value: jar.value } : undefined) };
  },
}));

import {
  metaCompleteRegistration,
  metaLeadOnEmailVerified,
  metaLeadOnFirstEmailVerification,
  metaPlanPurchase,
  purgeExpiredIpAndUa,
  resendTestEvents,
  saveAdAttribution,
} from "@/lib/meta-capi.server";

const FBP = "fb.1.1730000000000.1234567890";
const granted = { ads: "granted", fbp: FBP, fbc: null, clientIp: "203.0.113.10", clientUa: "UA" } as const;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
const sent = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

const paid = (livemode = true) => ({ propertyId: "prop-1", livemode, value: 495, currency: "usd", tier: "pro" });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("META_CAPI_ENABLED", "true");
  vi.stubEnv("META_CAPI_TOKEN", "tok_secret");
  vi.stubEnv("META_DATASET_ID", "958509363984889");
  vi.stubEnv("META_TEST_EVENT_CODE", "");
  vi.stubEnv("VERCEL_ENV", "production");
  db.property = { is_test: false, owner_id: "owner-1", pricing_tier: "pro" };
  db.attribution = { ads_consent: "granted", fbp: FBP, fbc: null, client_ip: "203.0.113.10", client_ua: "UA", updated_at: new Date().toISOString() };
  db.upserts = [];
  db.updates = [];
  db.purged = [];
  db.agreement = null;
  db.payment = null;
  jar.value = null;
  jar.reads = 0;
  jar.throws = false;
  jar.header = "";
  afterQueue.length = 0;
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
    db.attribution = { ads_consent: "denied", fbp: null, fbc: null, client_ip: null, client_ua: null, updated_at: null };
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("listing is_test en Production: no sale", async () => {
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Purchase (punto único de pago confirmado)", () => {
  const forgotIpUa = () => db.updates.some((u) => u.client_ip === null && u.client_ua === null);
  it("después del Purchase borra la IP y el user agent guardados", async () => {
    await metaPlanPurchase(paid());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forgotIpUa()).toBe(true);
  });
  it("también los borra si el Purchase no sale (apagada, pago de prueba o Publicidad denegada)", async () => {
    vi.stubEnv("META_CAPI_ENABLED", "");
    await metaPlanPurchase(paid());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(forgotIpUa()).toBe(true);
  });
  it("IP y user agent guardados hace más de 90 días no se envían", async () => {
    db.attribution = { ...db.attribution!, updated_at: new Date(Date.now() - 91 * 86_400_000).toISOString() };
    await metaPlanPurchase(paid());
    const ev = sent()[0].data[0];
    expect(ev.user_data.fbp).toBe(FBP);
    expect(ev.user_data).not.toHaveProperty("client_ip_address");
    expect(ev.user_data).not.toHaveProperty("client_user_agent");
  });
  it("con Publicidad guardada como aceptada: purchase_<listing>, valor en USD, identificadores guardados", async () => {
    await metaPlanPurchase(paid());
    const ev = sent()[0].data[0];
    expect(ev).toMatchObject({
      event_name: "Purchase",
      event_id: "purchase_prop-1",
      custom_data: { value: 495, currency: "USD", content_type: "product", content_ids: ["pro"], lang: "es" },
    });
    expect(ev.user_data).toMatchObject({ fbp: FBP, client_ip_address: "203.0.113.10", client_user_agent: "UA" });
    expect(JSON.stringify(ev)).not.toMatch(/owner@example\.com/i);
  });
  it("no depende del Checkout: lo guardado en denied (retiró la Publicidad) o sin fila → no sale", async () => {
    db.attribution = { ads_consent: "denied", fbp: null, fbc: null, client_ip: null, client_ua: null, updated_at: null };
    await metaPlanPurchase(paid());
    db.attribution = null;
    await metaPlanPurchase(paid());
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Production: pago de prueba de Stripe o listing is_test → no sale", async () => {
    await metaPlanPurchase(paid(false));
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    await metaPlanPurchase(paid());
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Preview con código de prueba: sale con test_event_code, también is_test y pago de prueba", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST123");
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    await metaPlanPurchase(paid(false));
    expect(sent()[0].test_event_code).toBe("TEST123");
    expect(sent()[0].data[0].event_id).toBe("purchase_prop-1");
  });
  it("Preview sin código de prueba: no sale", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    await metaPlanPurchase(paid(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Meta responde 500: un reintento y nunca lanza; 400: sin reintento", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const p = metaPlanPurchase(paid());
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    await metaPlanPurchase(paid());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("borrado diario de IP y user agent (cron)", () => {
  it("limpia las filas vencidas y dice cuántas", async () => {
    db.purged = [{ user_id: "a" }, { user_id: "b" }];
    await expect(purgeExpiredIpAndUa(new Date("2026-11-01T00:00:00Z"))).resolves.toBe(2);
    expect(db.updates[0]).toEqual({ client_ip: null, client_ua: null });
  });
});

describe("código de Eventos de prueba (Preview: el de la URL, guardado en la cookie)", () => {
  const logs = () =>
    vi.mocked(console.log).mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.event === "meta_capi");
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST36176");
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
  });
  it("la cookie válida gana a la variable, y el log lleva la respuesta de Meta y el código usado", async () => {
    jar.value = "TEST80832";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ events_received: 1, fbtrace_id: "AbC123" }), { status: 200 }));
    await metaPlanPurchase(paid(false));
    expect(sent()[0].test_event_code).toBe("TEST80832");
    expect(logs()[0]).toMatchObject({
      name: "Purchase",
      event_id: "purchase_prop-1",
      status: 200,
      events_received: 1,
      fbtrace_id: "AbC123",
      error: null,
      test_event_code: "TEST80832",
      test_code_source: "cookie",
    });
  });
  it("un 400 de Meta queda en el log con su código de error y fbtrace_id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid parameter", type: "OAuthException", code: 100, error_subcode: 2804003, fbtrace_id: "XyZ" } }), { status: 400 }),
    );
    await metaPlanPurchase(paid(false));
    expect(logs()[0]).toMatchObject({ status: 400, events_received: null, fbtrace_id: "XyZ", error: { code: 100, subcode: 2804003, type: "OAuthException" }, test_code_source: "env" });
  });
  it("cookie con otro formato: se usa la variable", async () => {
    jar.value = "TEST80832; injected";
    await metaPlanPurchase(paid(false));
    expect(sent()[0].test_event_code).toBe("TEST36176");
  });
  it("sin petición (webhook): cookies() falla y queda la variable", async () => {
    jar.throws = true;
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: null });
    expect(sent()[0].test_event_code).toBe("TEST36176");
  });
  it("Production: la cookie ni se lee y el envío no lleva código de prueba", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("META_TEST_EVENT_CODE", "");
    db.property = { is_test: false, owner_id: "owner-1", pricing_tier: "pro" };
    jar.value = "TEST80832";
    await metaPlanPurchase(paid());
    await metaCompleteRegistration({ propertyId: "prop-1", signedAt: null });
    expect(jar.reads).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const b of sent()) expect(b).not.toHaveProperty("test_event_code");
    for (const l of logs()) expect(l).not.toHaveProperty("test_event_code");
  });
});

describe("reenvío de validación (resendTestEvents)", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("META_TEST_EVENT_CODE", "");
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    db.agreement = { signed_at: "2026-11-05T00:28:53Z" };
    db.payment = { amount: 495, currency: "usd", tier: "pro", completed_at: "2026-11-05T00:30:41Z" };
    // IP y user agent ya borrados al pagar.
    db.attribution = { ads_consent: "granted", fbp: null, fbc: null, client_ip: null, client_ua: null, updated_at: new Date().toISOString() };
  });
  it("los tres eventos, mismos event_id, con el código dado y la respuesta de Meta por evento", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: "T1" }), { status: 200 }));
    const out = await resendTestEvents("prop-1", "TEST80832");
    expect(out).toEqual([
      { name: "Lead", event_id: "lead_owner-1", sent: true, status: 200, events_received: 1, fbtrace_id: "T1", error: null },
      { name: "CompleteRegistration", event_id: "agreement_prop-1", sent: true, status: 200, events_received: 1, fbtrace_id: "T1", error: null },
      { name: "Purchase", event_id: "purchase_prop-1", sent: true, status: 200, events_received: 1, fbtrace_id: "T1", error: null },
    ]);
    const bodies = sent();
    expect(bodies.map((b) => b.test_event_code)).toEqual(["TEST80832", "TEST80832", "TEST80832"]);
    expect(bodies[1].data[0].event_time).toBe(Date.UTC(2026, 10, 5, 0, 28, 53) / 1000);
    expect(bodies[2].data[0].custom_data).toMatchObject({ value: 495, currency: "USD", content_ids: ["pro"] });
    expect(bodies[2].data[0].user_data).not.toHaveProperty("client_ip_address");
    // No guarda ni borra nada.
    expect(db.upserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
  it("sin firma o sin pago: esos eventos no salen y dice por qué", async () => {
    db.agreement = null;
    db.payment = null;
    const out = await resendTestEvents("prop-1", "TEST80832");
    expect(out).toMatchObject([
      { name: "Lead", sent: true },
      { name: "CompleteRegistration", sent: false, reason: "agreement_not_signed" },
      { name: "Purchase", sent: false, reason: "no_succeeded_payment" },
    ]);
  });
  it("Publicidad guardada como rechazada: no sale ninguno", async () => {
    db.attribution = { ads_consent: "denied", fbp: null, fbc: null, client_ip: null, client_ua: null, updated_at: null };
    const out = await resendTestEvents("prop-1", "TEST80832");
    expect(out).toMatchObject([{ reason: "ads_denied" }, { reason: "ads_denied" }, { reason: "ads_denied" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("solo listings is_test y solo en Preview", async () => {
    db.property = { is_test: false, owner_id: "owner-1", pricing_tier: "pro" };
    await expect(resendTestEvents("prop-1", "TEST80832")).resolves.toBe("not_allowed");
    db.property = { is_test: true, owner_id: "owner-1", pricing_tier: "pro" };
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(resendTestEvents("prop-1", "TEST80832")).resolves.toBe("not_allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Lead en la primera verificación del correo por cualquier vía", () => {
  const runAfter = async () => {
    for (const fn of afterQueue.splice(0)) await fn();
  };
  const justNow = (over: Record<string, unknown> = {}) => ({
    id: "user-9",
    email: "Seller@Example.com",
    is_anonymous: false,
    email_confirmed_at: new Date(Date.now() - 30_000).toISOString(),
    ...over,
  });
  it("vía /sign-up (sin listing): guarda ad_attribution y envía lead_<user id> desde /sign-up", async () => {
    jar.header = `lx_consent=analytics-granted.ads-granted; _fbp=${FBP}`;
    await metaLeadOnFirstEmailVerification({ user: justNow(), lang: "es" });
    await runAfter();
    expect(db.upserts[0]).toMatchObject({ user_id: "user-9", ads_consent: "granted", fbp: FBP, client_ip: "203.0.113.20", client_ua: "UA2" });
    const ev = sent()[0].data[0];
    expect(ev).toMatchObject({
      event_name: "Lead",
      event_id: "lead_user-9",
      custom_data: { content_name: "account_registration", lang: "es" },
    });
    expect(ev.event_source_url).toMatch(/\/es\/sign-up$/);
    expect(JSON.stringify(sent()[0])).not.toMatch(/seller@example\.com/i);
  });
  it("vía paso 1 del listing y vía /sign-up: el mismo event_id para la misma persona", async () => {
    await metaLeadOnEmailVerified({ userId: "user-9", email: "s@example.com", propertyId: "prop-1", lang: "en", ids: granted });
    jar.header = "lx_consent=analytics-denied.ads-granted";
    await metaLeadOnFirstEmailVerification({ user: justNow(), lang: "en" });
    await runAfter();
    expect(sent().map((b) => b.data[0].event_id)).toEqual(["lead_user-9", "lead_user-9"]);
    expect(sent()[0].data[0].custom_data.content_name).toBe("listing_registration");
  });
  it("vía paso 7 (con listing): usa el listing para is_test y el registro como página", async () => {
    jar.header = "lx_consent=analytics-granted.ads-granted";
    db.property = { is_test: true, owner_id: "user-9", pricing_tier: "pro" };
    await metaLeadOnFirstEmailVerification({ user: justNow(), lang: "en", propertyId: "prop-1" });
    await runAfter();
    expect(fetchMock).not.toHaveBeenCalled(); // listing is_test en Production
    db.property = { is_test: false, owner_id: "user-9", pricing_tier: "pro" };
    await metaLeadOnFirstEmailVerification({ user: justNow(), lang: "en", propertyId: "prop-1" });
    await runAfter();
    expect(sent()[0].data[0]).toMatchObject({ event_id: "lead_user-9", custom_data: { content_name: "listing_registration" } });
  });
  it("sin consentimiento de Publicidad: guarda denied y no envía; sin elección: no guarda ni envía", async () => {
    jar.header = "lx_consent=analytics-granted.ads-denied";
    await metaLeadOnFirstEmailVerification({ user: justNow(), lang: "en" });
    await runAfter();
    expect(db.upserts[0]).toMatchObject({ user_id: "user-9", ads_consent: "denied", fbp: null, client_ip: null });
    jar.header = "";
    await metaLeadOnFirstEmailVerification({ user: justNow(), lang: "en" });
    await runAfter();
    expect(db.upserts).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("no es la primera verificación (correo confirmado hace días) o sin usuario: no hace nada", async () => {
    jar.header = "lx_consent=analytics-granted.ads-granted";
    await metaLeadOnFirstEmailVerification({ user: justNow({ email_confirmed_at: "2026-10-01T00:00:00Z" }), lang: "en" });
    await metaLeadOnFirstEmailVerification({ user: justNow({ is_anonymous: true }), lang: "en" });
    await metaLeadOnFirstEmailVerification({ user: null, lang: "en" });
    expect(afterQueue).toHaveLength(0);
    expect(db.upserts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

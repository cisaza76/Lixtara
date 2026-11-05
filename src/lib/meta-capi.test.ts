import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adIdentifiersFromRequest,
  buildMetaEvent,
  clientIpFrom,
  ipUaExpired,
  ipUaRetentionCutoff,
  listingFlowUrl,
  metaEventId,
  normalizeEmail,
  sha256Hex,
  resolveTestEventCode,
  shouldSendMeta,
  testCodeFromUrl,
  validTestEventCode,
  type AdIdentifiers,
} from "@/lib/meta-capi";
import { AD_IP_UA_RETENTION_DAYS, META_GRAPH_API_VERSION } from "@/config/meta";

const FBP = "fb.1.1730000000000.1234567890";
const FBC = "fb.1.1730000000000.IwAR0abc_DEF-1";
const both = (ads: string) => `lx_consent=analytics-granted.ads-${ads}; _fbp=${FBP}; _fbc=${FBC}`;
const req = (cookieHeader: string | null, gpc = false) =>
  adIdentifiersFromRequest({ cookieHeader, xForwardedFor: "203.0.113.10, 10.0.0.1", userAgent: "Mozilla/5.0 Test", gpc });

describe("consentimiento de Publicidad", () => {
  it("aceptada: fbp, fbc, la primera IP y el user agent", () => {
    expect(req(both("granted"))).toEqual({
      ads: "granted",
      fbp: FBP,
      fbc: FBC,
      clientIp: "203.0.113.10",
      clientUa: "Mozilla/5.0 Test",
    });
  });
  it("rechazada: solo el estado, ningún identificador", () => {
    expect(req(both("denied"))).toEqual({ ads: "denied" });
  });
  it("Global Privacy Control la deniega aunque la cookie diga granted", () => {
    expect(req(both("granted"), true)).toEqual({ ads: "denied" });
  });
  it("cookie vieja de solo analítica (granted) = Publicidad denegada", () => {
    expect(req(`lx_consent=granted; _fbp=${FBP}`)).toEqual({ ads: "denied" });
  });
  it("sin elección: unknown (no se envía ni se pisa lo guardado); con GPC, denied", () => {
    expect(req(`_fbp=${FBP}`)).toEqual({ ads: "unknown" });
    expect(req(null, true)).toEqual({ ads: "denied" });
  });
  it("fbp/fbc con forma rara se descartan; IP inválida también", () => {
    const ids = req("lx_consent=analytics-denied.ads-granted; _fbp=nope; _fbc=fb.1.x.y");
    expect(ids).toMatchObject({ ads: "granted", fbp: null, fbc: null });
    expect(clientIpFrom("<script>")).toBeNull();
    expect(clientIpFrom("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("cuándo sale un evento", () => {
  const base = { enabled: "true", hasConfig: true, testEventCode: undefined, propertyIsTest: false };
  it("Production: encendida, con token, sin código de prueba, listing real", () => {
    expect(shouldSendMeta({ ...base, vercelEnv: "production" })).toBe(true);
  });
  it("Production apagada por defecto (sin META_CAPI_ENABLED) hasta publicar §6.2", () => {
    expect(shouldSendMeta({ ...base, enabled: undefined, vercelEnv: "production" })).toBe(false);
    expect(shouldSendMeta({ ...base, enabled: "1", vercelEnv: "production" })).toBe(false);
  });
  it("Production nunca con código de prueba, con is_test, ni con un pago de prueba", () => {
    expect(shouldSendMeta({ ...base, vercelEnv: "production", testEventCode: "TEST123" })).toBe(false);
    expect(shouldSendMeta({ ...base, vercelEnv: "production", propertyIsTest: true })).toBe(false);
    expect(shouldSendMeta({ ...base, vercelEnv: "production", propertyIsTest: null })).toBe(false);
    expect(shouldSendMeta({ ...base, vercelEnv: "production", livemode: false })).toBe(false);
    expect(shouldSendMeta({ ...base, vercelEnv: "production", livemode: true })).toBe(true);
  });
  it("Preview: solo con código de prueba (también listings is_test y pagos de prueba)", () => {
    expect(shouldSendMeta({ ...base, vercelEnv: "preview" })).toBe(false);
    expect(shouldSendMeta({ ...base, vercelEnv: "preview", testEventCode: "TEST123", propertyIsTest: true, livemode: false })).toBe(true);
  });
  it("Development / local: nunca; sin token o conjunto de datos: nunca", () => {
    expect(shouldSendMeta({ ...base, vercelEnv: "development", testEventCode: "TEST123" })).toBe(false);
    expect(shouldSendMeta({ ...base, vercelEnv: undefined })).toBe(false);
    expect(shouldSendMeta({ ...base, hasConfig: false, vercelEnv: "production" })).toBe(false);
  });
});

describe("el evento", () => {
  const ids: AdIdentifiers = { ads: "granted", fbp: FBP, fbc: FBC, clientIp: "203.0.113.10", clientUa: "Mozilla/5.0" };
  const ev = buildMetaEvent({
    name: "Lead",
    eventId: metaEventId.lead("user-1"),
    eventTime: new Date("2026-11-09T15:00:00Z"),
    sourceUrl: "https://lixtara.com/en/listing/new?id=abc&step=2#x",
    email: "  Seller@Example.COM ",
    userId: "user-1",
    ids,
    customData: { content_name: "listing_registration", lang: "en" },
  })!;

  it("correo e id del usuario en SHA-256 hex; fbp, fbc, IP y navegador tal cual", () => {
    expect(ev.user_data.em).toEqual([sha256Hex("seller@example.com")]);
    expect(ev.user_data.em![0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.user_data.external_id).toEqual([sha256Hex("user-1")]);
    expect(ev.user_data).toMatchObject({ fbp: FBP, fbc: FBC, client_ip_address: "203.0.113.10", client_user_agent: "Mozilla/5.0" });
    expect(normalizeEmail(" A@B.co ")).toBe("a@b.co");
  });
  it("nada en claro: ni el correo, ni nombre, teléfono o dirección", () => {
    const json = JSON.stringify(ev);
    expect(json).not.toMatch(/seller@example\.com/i);
    expect(Object.keys(ev.user_data).sort()).toEqual(
      ["client_ip_address", "client_user_agent", "em", "external_id", "fbc", "fbp"],
    );
  });
  it("URL sin parámetros ni fragmento, hora en segundos, website", () => {
    expect(ev.event_source_url).toBe("https://lixtara.com/en/listing/new");
    expect(ev.event_time).toBe(Date.UTC(2026, 10, 9, 15) / 1000);
    expect(ev.action_source).toBe("website");
  });
  it("sin Publicidad aceptada no hay evento", () => {
    for (const no of [{ ads: "denied" }, { ads: "unknown" }] as AdIdentifiers[]) {
      expect(buildMetaEvent({ name: "Purchase", eventId: "x", eventTime: 1, sourceUrl: "https://lixtara.com", email: "a@b.co", userId: "u", ids: no, customData: {} })).toBeNull();
    }
  });
  it("event_id estables por hito", () => {
    expect(metaEventId.lead("u1")).toBe("lead_u1");
    expect(metaEventId.agreement("p1")).toBe("agreement_p1");
    expect(metaEventId.purchase("p1")).toBe("purchase_p1");
    expect(listingFlowUrl("https://lixtara.com/", "es")).toBe("https://lixtara.com/es/listing/new");
    expect(listingFlowUrl("https://lixtara.com", "fr")).toBe("https://lixtara.com/en/listing/new");
  });
});

describe("conservación de IP y user agent", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("90 días, o sin fecha: vencidos", () => {
    expect(AD_IP_UA_RETENTION_DAYS).toBe(90);
    expect(ipUaRetentionCutoff(now).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(ipUaExpired("2026-08-04T00:00:00Z", now)).toBe(false);
    expect(ipUaExpired("2026-08-02T00:00:00Z", now)).toBe(true);
    expect(ipUaExpired(null, now)).toBe(true);
    expect(ipUaExpired("no es fecha", now)).toBe(true);
  });
  it("el borrado diario está programado y protegido con CRON_SECRET", () => {
    const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons as { path: string }[];
    expect(crons.map((c) => c.path)).toContain("/api/ad-attribution/retention");
    expect(readFileSync("src/app/api/ad-attribution/retention/route.ts", "utf8")).toContain("if (!verifyCronSecret(req))");
  });
});

describe("el envío (código)", () => {
  const server = readFileSync("src/lib/meta-capi.server.ts", "utf8");
  it("Graph API en una constante de configuración", () => {
    expect(META_GRAPH_API_VERSION).toMatch(/^v\d+\.0$/);
    expect(server).toContain("${META_GRAPH_URL}/${META_GRAPH_API_VERSION}/${datasetId}/events");
  });
  it("el token va en el cuerpo, nunca en la URL ni en los logs", () => {
    expect(server).not.toMatch(/events\?access_token/);
    expect(server).not.toMatch(/console\.\w+\([^)]*token/i);
  });
  it("los logs llevan solo nombre, event_id y estado: nunca el correo", () => {
    for (const line of server.split("\n").filter((l) => /console\.(log|error)/.test(l))) {
      expect(line).not.toMatch(/email|em:|user_data/);
    }
  });
  it("test_event_code solo en Preview", () => {
    expect(server).toContain('const preview = process.env.VERCEL_ENV === "preview";');
    expect(server).toContain("...(preview && test.code ? { test_event_code: test.code } : {}),");
    // La cookie del código de prueba solo se lee en Preview.
    expect(server).toMatch(/if \(process\.env\.VERCEL_ENV === "preview"\) \{\n\s+try \{\n\s+jar = await nextCookies\(\);/);
  });
  it("los tres hitos están conectados", () => {
    expect(readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8")).toContain("metaLeadOnEmailVerified({ userId: user.id");
    expect(readFileSync("src/lib/agreement-refresh.ts", "utf8")).toContain("await metaCompleteRegistration({ propertyId: a.property_id");
    expect(readFileSync("src/lib/tier-fulfillment.server.ts", "utf8")).toContain("await metaPlanPurchase({");
    expect(readFileSync("src/app/api/checkout/tier/route.ts", "utf8")).toContain("after(() => saveAdAttribution(user.id, adIds));");
  });
  it("el aviso de cookies avisa al servidor solo al guardar una elección; nunca un denied por la ruta ni por abrir 'Configurar cookies'", () => {
    const banner = readFileSync("src/components/analytics-consent.tsx", "utf8");
    expect(banner).toMatch(/function setConsent\(choice: ConsentState\): void \{\n  saveChoice\(choice\);\n  syncAdAttribution\(\);/);
    expect(banner.match(/syncAdAttribution\(/g)).toHaveLength(2); // la definición y setConsent
    const route = readFileSync("src/app/api/ad-attribution/route.ts", "utf8");
    expect(route).not.toMatch(/reset/);
    expect(route).not.toMatch(/isAdsExcludedPath/);
    expect(route).toContain("if (!user) return new NextResponse(null, { status: 204 });");
  });
  it("Sec-GPC en el servidor: Publicidad denegada en cada punto que guarda o lee la elección", () => {
    const route = readFileSync("src/app/api/ad-attribution/route.ts", "utf8");
    expect(route).toContain('gpc: gpcEnabled(req.headers.get("sec-gpc"))');
    expect(readFileSync("src/app/api/checkout/tier/route.ts", "utf8")).toContain('gpc: gpcEnabled(req.headers.get("sec-gpc"))');
    expect(readFileSync("src/lib/meta-capi.server.ts", "utf8")).toContain('gpc: gpcEnabled(h.get("sec-gpc"))');
    // Al volver de firmar (paso 7) y de pagar (paso 8) se guarda la elección vigente antes del evento.
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page.match(/await saveAdAttribution\(sessionUser\.id, await adIdentifiersFromCurrentRequest\(\)\)/g)).toHaveLength(2);
  });
});

describe("código de Eventos de prueba por URL (solo Preview)", () => {
  it("formato: TEST + dígitos; nada más", () => {
    expect(validTestEventCode("TEST80832")).toBe("TEST80832");
    expect(validTestEventCode(" TEST80832 ")).toBe("TEST80832");
    for (const v of ["test80832", "TEST", "TEST12a", "80832", "TEST1234567890123", "", null, undefined]) {
      expect(validTestEventCode(v), String(v)).toBeNull();
    }
  });
  it("de la URL solo en Preview", () => {
    expect(testCodeFromUrl("preview", "TEST80832")).toBe("TEST80832");
    expect(testCodeFromUrl("production", "TEST80832")).toBeNull();
    expect(testCodeFromUrl(undefined, "TEST80832")).toBeNull();
  });
  it("Preview: la cookie válida gana a la variable; inválida o sin cookie, la variable", () => {
    const r = (cookie: string | null, env?: string) => resolveTestEventCode({ vercelEnv: "preview", envValue: env, cookieValue: () => cookie });
    expect(r("TEST80832", "TEST36176")).toEqual({ code: "TEST80832", source: "cookie" });
    expect(r("nope", "TEST36176")).toEqual({ code: "TEST36176", source: "env" });
    expect(r(null, undefined)).toEqual({ code: undefined, source: null });
  });
  it("Production: la cookie ni se lee; solo la variable (que apaga el envío)", () => {
    let read = 0;
    const cookieValue = () => {
      read++;
      return "TEST80832";
    };
    expect(resolveTestEventCode({ vercelEnv: "production", envValue: undefined, cookieValue })).toEqual({ code: undefined, source: null });
    expect(resolveTestEventCode({ vercelEnv: "production", envValue: "TEST1", cookieValue }).code).toBe("TEST1");
    expect(read).toBe(0);
  });
});

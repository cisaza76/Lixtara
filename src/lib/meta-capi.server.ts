// API de Conversiones de Meta: guarda los identificadores (tabla ad_attribution) y envía
// los tres eventos de servidor. Reglas en meta-capi.ts.
//
// Nunca lanza ni frena el flujo: tiempo límite corto, un reintento, y un fallo de Meta solo
// queda en el log (código de respuesta y event_id; nunca el correo, ni cifrado).
//
// Variables (server-only):
//   - META_CAPI_ENABLED = "true" para enviar. Apagada en Production hasta que el texto de
//     Privacidad §6.2 esté aprobado y publicado.
//   - META_CAPI_TOKEN: lo genera el CMO en el Administrador de eventos. Nunca en el código.
//   - META_DATASET_ID: el conjunto de datos (no es secreto).
//   - META_TEST_EVENT_CODE: solo Preview (Eventos de prueba), nunca Production. En Preview
//     manda el de ?meta_test_code=TEST… (cookie lx_meta_test, la pone el proxy) si lo hay.

import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { after } from "next/server";
import { createService } from "@/lib/supabase/service";
import { META_GRAPH_API_VERSION, META_GRAPH_URL } from "@/config/meta";
import { SITE_URL } from "@/lib/config";
import { gpcEnabled } from "@/lib/analytics-config";
import { lookupRecipientLang } from "@/lib/email-recipient-lang";
import {
  adIdentifiersFromRequest,
  buildMetaEvent,
  emailJustConfirmed,
  ipUaExpired,
  ipUaRetentionCutoff,
  listingFlowUrl,
  META_TEST_CODE_COOKIE,
  metaEventId,
  resolveTestEventCode,
  shouldSendMeta,
  signUpFlowUrl,
  type AdIdentifiers,
  type MetaServerEvent,
} from "@/lib/meta-capi";

const TIMEOUT_MS = 3000;

function config() {
  const token = process.env.META_CAPI_TOKEN?.trim();
  const datasetId = process.env.META_DATASET_ID?.trim();
  return { token, datasetId: datasetId && /^\d{5,20}$/.test(datasetId) ? datasetId : undefined };
}

export type TestCode = { code: string | undefined; source: "cookie" | "env" | "request" | null };

/**
 * Código de Eventos de prueba de esta petición. La cookie solo se lee en Preview; sin
 * petición (webhook, cron, after() de una página) cookies() falla y queda la variable.
 */
export async function currentTestCode(): Promise<TestCode> {
  let jar: Awaited<ReturnType<typeof nextCookies>> | null = null;
  if (process.env.VERCEL_ENV === "preview") {
    try {
      jar = await nextCookies();
    } catch {
      jar = null;
    }
  }
  return resolveTestEventCode({
    vercelEnv: process.env.VERCEL_ENV,
    envValue: process.env.META_TEST_EVENT_CODE,
    cookieValue: () => jar?.get(META_TEST_CODE_COOKIE)?.value,
  });
}

function allowed(test: TestCode, propertyIsTest: boolean | null, livemode?: boolean): boolean {
  const { token, datasetId } = config();
  return shouldSendMeta({
    enabled: process.env.META_CAPI_ENABLED,
    hasConfig: Boolean(token && datasetId),
    vercelEnv: process.env.VERCEL_ENV,
    testEventCode: test.code,
    propertyIsTest,
    livemode,
  });
}

/** Identificadores de la petición actual del navegador (server action o página). */
export async function adIdentifiersFromCurrentRequest(): Promise<AdIdentifiers> {
  const h = await nextHeaders();
  return adIdentifiersFromRequest({
    cookieHeader: h.get("cookie"),
    xForwardedFor: h.get("x-forwarded-for"),
    userAgent: h.get("user-agent"),
    gpc: gpcEnabled(h.get("sec-gpc")),
  });
}

/**
 * Guarda (o actualiza) los identificadores de la persona para los hitos que llegan sin su
 * navegador (firma por el webhook de DocuSign, pago por el de Stripe). Sin elección en la
 * cookie no toca nada; con Publicidad rechazada (o GPC) borra lo que hubiera.
 */
export async function saveAdAttribution(userId: string, ids: AdIdentifiers): Promise<void> {
  if (ids.ads === "unknown") return;
  try {
    const row =
      ids.ads === "granted"
        ? { ads_consent: "granted", fbp: ids.fbp, fbc: ids.fbc, client_ip: ids.clientIp, client_ua: ids.clientUa }
        : { ads_consent: "denied", fbp: null, fbc: null, client_ip: null, client_ua: null };
    const { error } = await createService()
      .from("ad_attribution")
      .upsert({ user_id: userId, ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) console.error(JSON.stringify({ event: "ad_attribution_save_failed", code: error.code }));
  } catch (e) {
    console.error(JSON.stringify({ event: "ad_attribution_save_failed", message: e instanceof Error ? e.message : "error" }));
  }
}

async function storedIdentifiers(userId: string): Promise<AdIdentifiers> {
  const { data } = await createService()
    .from("ad_attribution")
    .select("ads_consent, fbp, fbc, client_ip, client_ua, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  const r = data as {
    ads_consent: string;
    fbp: string | null;
    fbc: string | null;
    client_ip: string | null;
    client_ua: string | null;
    updated_at: string | null;
  } | null;
  if (!r) return { ads: "unknown" };
  if (r.ads_consent !== "granted") return { ads: "denied" };
  // Pasado el plazo, la IP y el user agent no se usan aunque el borrado diario no haya corrido.
  const expired = ipUaExpired(r.updated_at, new Date());
  return {
    ads: "granted",
    fbp: r.fbp,
    fbc: r.fbc,
    clientIp: expired ? null : r.client_ip,
    clientUa: expired ? null : r.client_ua,
  };
}

/** Borra la IP y el user agent guardados de una persona (fbp, fbc y la elección quedan). */
async function forgetIpAndUa(userId: string): Promise<void> {
  const { error } = await createService()
    .from("ad_attribution")
    .update({ client_ip: null, client_ua: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) console.error(JSON.stringify({ event: "ad_attribution_forget_failed", code: error.code }));
}

/**
 * Borrado diario (cron): IP y user agent guardados hace más de AD_IP_UA_RETENTION_DAYS. Cada
 * guardado con Publicidad aceptada reescribe los dos, así que updated_at es su fecha.
 * Devuelve cuántas filas limpió; null si la tabla aún no existe (migración sin aplicar).
 */
export async function purgeExpiredIpAndUa(now = new Date()): Promise<number | null> {
  const { data, error } = await createService()
    .from("ad_attribution")
    .update({ client_ip: null, client_ua: null })
    .lt("updated_at", ipUaRetentionCutoff(now).toISOString())
    .or("client_ip.not.is.null,client_ua.not.is.null")
    .select("user_id");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new Error(`ad_attribution purge: ${error.code ?? error.message}`);
  }
  return (data ?? []).length;
}

async function propertyInfo(propertyId: string) {
  const { data } = await createService()
    .from("properties")
    .select("is_test, owner_id, pricing_tier")
    .eq("id", propertyId)
    .maybeSingle();
  return data as { is_test: boolean | null; owner_id: string | null; pricing_tier: string | null } | null;
}

/** Lo que respondió Meta a un envío (nada del cuerpo enviado). */
export type MetaSendResult = {
  status: number | null;
  events_received: number | null;
  fbtrace_id: string | null;
  error: { code: number | null; subcode: number | null; type: string | null; message: string | null } | null;
};

async function readMetaResponse(res: Response): Promise<MetaSendResult> {
  let body: {
    events_received?: number;
    fbtrace_id?: string;
    error?: { code?: number; error_subcode?: number; type?: string; message?: string; fbtrace_id?: string };
  } = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  const err = body.error;
  return {
    status: res.status,
    events_received: typeof body.events_received === "number" ? body.events_received : null,
    fbtrace_id: body.fbtrace_id ?? err?.fbtrace_id ?? null,
    error: err
      ? { code: err.code ?? null, subcode: err.error_subcode ?? null, type: err.type ?? null, message: err.message?.slice(0, 300) ?? null }
      : null,
  };
}

/**
 * POST al conjunto de datos, con un reintento si Meta no responde o responde 429/5xx. El log
 * lleva la respuesta de Meta (events_received, fbtrace_id, error) y, solo en Preview, el
 * código de prueba usado y de dónde salió.
 */
async function post(event: MetaServerEvent, test: TestCode): Promise<MetaSendResult> {
  const { token, datasetId } = config();
  const preview = process.env.VERCEL_ENV === "preview";
  const url = `${META_GRAPH_URL}/${META_GRAPH_API_VERSION}/${datasetId}/events`;
  const body = JSON.stringify({
    data: [event],
    access_token: token,
    ...(preview && test.code ? { test_event_code: test.code } : {}),
  });
  let last: MetaSendResult = { status: null, events_received: null, fbtrace_id: null, error: null };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      last = await readMetaResponse(res);
      console.log(
        JSON.stringify({
          event: "meta_capi",
          name: event.event_name,
          event_id: event.event_id,
          ...last,
          attempt,
          ...(preview ? { test_event_code: test.code ?? null, test_code_source: test.source } : {}),
        }),
      );
      if (res.ok || (res.status < 500 && res.status !== 429)) return last;
    } catch (e) {
      console.error(JSON.stringify({ event: "meta_capi_failed", name: event.event_name, event_id: event.event_id, attempt, message: e instanceof Error ? e.name : "error" }));
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

/** Dónde se verificó el correo: en el registro de un listing o al crear la cuenta. */
export type LeadSource = "listing" | "account";

function leadEvent(input: { userId: string; email: string | null; lang: string; ids: AdIdentifiers; at: Date; source?: LeadSource }) {
  const account = input.source === "account";
  return buildMetaEvent({
    name: "Lead",
    eventId: metaEventId.lead(input.userId),
    eventTime: input.at,
    sourceUrl: account ? signUpFlowUrl(SITE_URL, input.lang) : listingFlowUrl(SITE_URL, input.lang),
    email: input.email,
    userId: input.userId,
    ids: input.ids,
    customData: { content_name: account ? "account_registration" : "listing_registration", lang: input.lang === "es" ? "es" : "en" },
  });
}

function agreementEvent(input: { propertyId: string; ownerId: string; email: string | null; lang: string; tier: string | null; ids: AdIdentifiers; at: Date }) {
  return buildMetaEvent({
    name: "CompleteRegistration",
    eventId: metaEventId.agreement(input.propertyId),
    eventTime: input.at,
    sourceUrl: listingFlowUrl(SITE_URL, input.lang),
    email: input.email,
    userId: input.ownerId,
    ids: input.ids,
    customData: {
      content_name: "listing_agreement",
      ...(input.tier ? { plan_tier: input.tier } : {}),
      lang: input.lang,
    },
  });
}

function purchaseEvent(input: { propertyId: string; ownerId: string; email: string | null; lang: string; value: number; currency: string; tier: string; ids: AdIdentifiers; at: Date }) {
  return buildMetaEvent({
    name: "Purchase",
    eventId: metaEventId.purchase(input.propertyId),
    eventTime: input.at,
    sourceUrl: listingFlowUrl(SITE_URL, input.lang),
    email: input.email,
    userId: input.ownerId,
    ids: input.ids,
    customData: {
      value: input.value,
      currency: input.currency.toUpperCase(),
      content_type: "product",
      content_ids: [input.tier],
      lang: input.lang,
    },
  });
}

/**
 * Lead: la persona verificó su correo por primera vez (paso 1 del registro, o
 * metaLeadOnFirstEmailVerification desde las otras vías). `ids` sale de la cookie de ESA
 * petición (adIdentifiersFromCurrentRequest, leída antes de after()); se guardan para la
 * firma y el pago. Sin listing (creación de cuenta) cuenta como no is_test.
 */
export async function metaLeadOnEmailVerified(input: {
  userId: string;
  email: string | null | undefined;
  propertyId: string | null;
  lang: string;
  source?: LeadSource;
  ids: AdIdentifiers;
  /** Leído antes de after() (ahí la cookie ya no se puede leer). */
  testCode?: TestCode;
}): Promise<void> {
  const ids = input.ids;
  try {
    await saveAdAttribution(input.userId, ids);
    const prop = input.propertyId ? await propertyInfo(input.propertyId) : null;
    const test = input.testCode ?? (await currentTestCode());
    // Con un listing que no se encuentra: null (no sale en Production).
    const isTest = input.propertyId ? (prop ? Boolean(prop.is_test) : null) : false;
    if (!allowed(test, isTest)) return;
    const event = leadEvent({ userId: input.userId, email: input.email ?? null, lang: input.lang, ids, at: new Date(), source: input.source });
    if (event) await post(event, test);
  } catch (e) {
    console.error(JSON.stringify({ event: "meta_capi_failed", name: "Lead", message: e instanceof Error ? e.message : "error" }));
  }
}

/**
 * Lead desde las vías de Supabase Auth (código de /sign-up, /auth/callback, /auth/confirm,
 * código del paso 7): solo si esa verificación es la PRIMERA del correo (emailJustConfirmed),
 * con la elección de Publicidad de ESTA petición, guardándola en ad_attribution como el
 * paso 1. Lee la petición ya y envía después de responder (after). Nunca lanza.
 */
export async function metaLeadOnFirstEmailVerification(input: {
  user: { id: string; is_anonymous?: boolean; email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined;
  lang: string;
  propertyId?: string | null;
}): Promise<void> {
  try {
    const user = input.user;
    if (!user || !emailJustConfirmed(user, new Date())) return;
    const ids = await adIdentifiersFromCurrentRequest();
    const testCode = await currentTestCode();
    const propertyId = input.propertyId ?? null;
    after(() =>
      metaLeadOnEmailVerified({
        userId: user.id,
        email: user.email,
        propertyId,
        lang: input.lang,
        source: propertyId ? "listing" : "account",
        ids,
        testCode,
      }),
    );
  } catch (e) {
    console.error(JSON.stringify({ event: "meta_capi_failed", name: "Lead", message: e instanceof Error ? e.message : "error" }));
  }
}

/**
 * CompleteRegistration: el contrato quedó firmado (transición a signed/completed). Puede
 * llegar por el webhook de DocuSign, sin navegador: usa lo guardado del vendedor principal.
 */
export async function metaCompleteRegistration(input: { propertyId: string; signedAt: string | null }): Promise<void> {
  try {
    const prop = await propertyInfo(input.propertyId);
    if (!prop?.owner_id) return;
    const test = await currentTestCode();
    if (!allowed(test, Boolean(prop.is_test))) return;
    const ids = await storedIdentifiers(prop.owner_id);
    if (ids.ads !== "granted") return;
    const [{ data: owner }, lang] = await Promise.all([
      createService().auth.admin.getUserById(prop.owner_id),
      lookupRecipientLang(prop.owner_id),
    ]);
    const event = agreementEvent({
      propertyId: input.propertyId,
      ownerId: prop.owner_id,
      email: owner?.user?.email ?? null,
      lang: lang ?? "en",
      tier: prop.pricing_tier,
      ids,
      at: input.signedAt ? new Date(input.signedAt) : new Date(),
    });
    if (event) await post(event, test);
  } catch (e) {
    console.error(JSON.stringify({ event: "meta_capi_failed", name: "CompleteRegistration", message: e instanceof Error ? e.message : "error" }));
  }
}

/**
 * Purchase: el pago del plan quedó confirmado. Punto ÚNICO, independiente de cómo se cobró
 * (hoy Checkout, en fulfillTierCheckout; mañana un cobro off_session por
 * payment_intent.succeeded debe llamar a esta misma función). Por eso no lee nada del
 * Checkout: el consentimiento, fbp, fbc, IP y user agent son los guardados en ad_attribution
 * (vigentes: el aviso de cookies y "Configurar cookies" los actualizan); el correo, el del
 * vendedor principal. Un pago por listing: event_id purchase_<listing id>.
 *
 * Quien la llame lo hace cuando el cobro está CONFIRMADO (no al guardar una tarjeta) y con el
 * monto realmente cobrado. Al terminar, se envíe o no el evento, se borran la IP y el user
 * agent guardados del vendedor principal: ya no hay más hitos que los necesiten.
 */
export async function metaPlanPurchase(input: {
  propertyId: string;
  /** Stripe livemode del pago (Production no envía pagos de prueba). */
  livemode: boolean;
  /** Monto cobrado, en la unidad de la moneda (495, no 49500). */
  value: number;
  currency: string;
  tier: string | null;
}): Promise<void> {
  let ownerId: string | null = null;
  try {
    const prop = await propertyInfo(input.propertyId);
    if (!prop?.owner_id) return;
    ownerId = prop.owner_id;
    const test = await currentTestCode();
    if (!allowed(test, Boolean(prop.is_test), input.livemode)) return;
    const ids = await storedIdentifiers(prop.owner_id);
    if (ids.ads !== "granted") return;
    const [{ data: owner }, lang] = await Promise.all([
      createService().auth.admin.getUserById(prop.owner_id),
      lookupRecipientLang(prop.owner_id),
    ]);
    const event = purchaseEvent({
      propertyId: input.propertyId,
      ownerId: prop.owner_id,
      email: owner?.user?.email ?? null,
      lang: lang ?? "en",
      value: input.value,
      currency: input.currency,
      tier: input.tier ?? prop.pricing_tier ?? "plan",
      ids,
      // La hora de la confirmación del pago (esta llamada).
      at: new Date(),
    });
    if (event) await post(event, test);
  } catch (e) {
    console.error(JSON.stringify({ event: "meta_capi_failed", name: "Purchase", message: e instanceof Error ? e.message : "error" }));
  } finally {
    if (ownerId) await forgetIpAndUa(ownerId).catch(() => {});
  }
}

export type ResentEvent =
  | ({ name: "Lead" | "CompleteRegistration" | "Purchase"; event_id: string; sent: true } & MetaSendResult)
  | { name: "Lead" | "CompleteRegistration" | "Purchase"; event_id: string; sent: false; reason: string };

/**
 * Reenvío de validación (solo Preview, solo staff, solo listings is_test; lo comprueba la
 * ruta /api/meta/test-events y otra vez aquí): los tres eventos del listing con sus mismos
 * event_id, lo guardado en ad_attribution (la IP y el user agent pueden faltar: se borran al
 * pagar) y el código de Eventos de prueba dado. No guarda ni borra nada.
 */
export async function resendTestEvents(propertyId: string, testEventCode: string): Promise<ResentEvent[] | "not_allowed"> {
  const prop = await propertyInfo(propertyId);
  if (process.env.VERCEL_ENV !== "preview" || !prop?.owner_id || prop.is_test !== true) return "not_allowed";
  const test: TestCode = { code: testEventCode, source: "request" };
  if (!allowed(test, true, false)) return "not_allowed";
  const ownerId = prop.owner_id;
  const db = createService();
  const [ids, { data: owner }, lang, { data: agreement }, { data: payment }] = await Promise.all([
    storedIdentifiers(ownerId),
    db.auth.admin.getUserById(ownerId),
    lookupRecipientLang(ownerId),
    db
      .from("agreements")
      .select("signed_at")
      .eq("property_id", propertyId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("payments")
      .select("amount, currency, tier, completed_at")
      .eq("property_id", propertyId)
      .eq("status", "succeeded")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const email = owner?.user?.email ?? null;
  const l = lang ?? "en";
  const signed = agreement as { signed_at: string | null } | null;
  const paid = payment as { amount: number | string | null; currency: string | null; tier: string | null; completed_at: string | null } | null;

  const plan: Array<{ name: ResentEvent["name"]; event_id: string; build: () => MetaServerEvent | null; missing: string | null }> = [
    {
      name: "Lead",
      event_id: metaEventId.lead(ownerId),
      build: () => leadEvent({ userId: ownerId, email, lang: l, ids, at: new Date() }),
      missing: null,
    },
    {
      name: "CompleteRegistration",
      event_id: metaEventId.agreement(propertyId),
      build: () =>
        agreementEvent({ propertyId, ownerId, email, lang: l, tier: prop.pricing_tier, ids, at: new Date(signed!.signed_at!) }),
      missing: signed?.signed_at ? null : "agreement_not_signed",
    },
    {
      name: "Purchase",
      event_id: metaEventId.purchase(propertyId),
      build: () =>
        purchaseEvent({
          propertyId,
          ownerId,
          email,
          lang: l,
          value: Number(paid!.amount ?? 0),
          currency: paid!.currency ?? "usd",
          tier: paid!.tier ?? prop.pricing_tier ?? "plan",
          ids,
          at: paid!.completed_at ? new Date(paid!.completed_at) : new Date(),
        }),
      missing: paid ? null : "no_succeeded_payment",
    },
  ];

  const out: ResentEvent[] = [];
  for (const p of plan) {
    if (ids.ads !== "granted") {
      out.push({ name: p.name, event_id: p.event_id, sent: false, reason: ids.ads === "denied" ? "ads_denied" : "no_ad_attribution" });
      continue;
    }
    if (p.missing) {
      out.push({ name: p.name, event_id: p.event_id, sent: false, reason: p.missing });
      continue;
    }
    const event = p.build();
    if (!event) {
      out.push({ name: p.name, event_id: p.event_id, sent: false, reason: "not_built" });
      continue;
    }
    out.push({ name: p.name, event_id: p.event_id, sent: true, ...(await post(event, test)) });
  }
  return out;
}

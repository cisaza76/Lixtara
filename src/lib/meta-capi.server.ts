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
//   - META_TEST_EVENT_CODE: solo Preview (Eventos de prueba), nunca Production.

import { headers as nextHeaders } from "next/headers";
import { createService } from "@/lib/supabase/service";
import { META_GRAPH_API_VERSION, META_GRAPH_URL } from "@/config/meta";
import { SITE_URL } from "@/lib/config";
import { gpcEnabled } from "@/lib/analytics-config";
import { lookupRecipientLang } from "@/lib/email-recipient-lang";
import {
  adIdentifiersFromRequest,
  buildMetaEvent,
  ipUaExpired,
  ipUaRetentionCutoff,
  listingFlowUrl,
  metaEventId,
  shouldSendMeta,
  type AdIdentifiers,
  type MetaServerEvent,
} from "@/lib/meta-capi";

const TIMEOUT_MS = 3000;

function config() {
  const token = process.env.META_CAPI_TOKEN?.trim();
  const datasetId = process.env.META_DATASET_ID?.trim();
  return { token, datasetId: datasetId && /^\d{5,20}$/.test(datasetId) ? datasetId : undefined };
}

function allowed(propertyIsTest: boolean | null, livemode?: boolean): boolean {
  const { token, datasetId } = config();
  return shouldSendMeta({
    enabled: process.env.META_CAPI_ENABLED,
    hasConfig: Boolean(token && datasetId),
    vercelEnv: process.env.VERCEL_ENV,
    testEventCode: process.env.META_TEST_EVENT_CODE,
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

/** POST al conjunto de datos, con un reintento si Meta no responde o responde 429/5xx. */
async function post(event: MetaServerEvent): Promise<void> {
  const { token, datasetId } = config();
  const testCode = process.env.META_TEST_EVENT_CODE?.trim();
  const url = `${META_GRAPH_URL}/${META_GRAPH_API_VERSION}/${datasetId}/events`;
  const body = JSON.stringify({
    data: [event],
    access_token: token,
    ...(process.env.VERCEL_ENV === "preview" && testCode ? { test_event_code: testCode } : {}),
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      console.log(JSON.stringify({ event: "meta_capi", name: event.event_name, event_id: event.event_id, status: res.status, attempt }));
      if (res.ok || (res.status < 500 && res.status !== 429)) return;
    } catch (e) {
      console.error(JSON.stringify({ event: "meta_capi_failed", name: event.event_name, event_id: event.event_id, attempt, message: e instanceof Error ? e.name : "error" }));
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Lead: el vendedor verificó su correo en el paso 1. `ids` sale de la cookie de ESA
 * petición (adIdentifiersFromCurrentRequest, leída antes de after()); se guardan para la
 * firma y el pago.
 */
export async function metaLeadOnEmailVerified(input: {
  userId: string;
  email: string | null | undefined;
  propertyId: string;
  lang: string;
  ids: AdIdentifiers;
}): Promise<void> {
  const ids = input.ids;
  try {
    await saveAdAttribution(input.userId, ids);
    const prop = await propertyInfo(input.propertyId);
    if (!allowed(prop ? Boolean(prop.is_test) : null)) return;
    const event = buildMetaEvent({
      name: "Lead",
      eventId: metaEventId.lead(input.userId),
      eventTime: new Date(),
      sourceUrl: listingFlowUrl(SITE_URL, input.lang),
      email: input.email ?? null,
      userId: input.userId,
      ids,
      customData: { content_name: "listing_registration", lang: input.lang === "es" ? "es" : "en" },
    });
    if (event) await post(event);
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
    if (!allowed(Boolean(prop.is_test))) return;
    const ids = await storedIdentifiers(prop.owner_id);
    if (ids.ads !== "granted") return;
    const [{ data: owner }, lang] = await Promise.all([
      createService().auth.admin.getUserById(prop.owner_id),
      lookupRecipientLang(prop.owner_id),
    ]);
    const event = buildMetaEvent({
      name: "CompleteRegistration",
      eventId: metaEventId.agreement(input.propertyId),
      eventTime: input.signedAt ? new Date(input.signedAt) : new Date(),
      sourceUrl: listingFlowUrl(SITE_URL, lang ?? "en"),
      email: owner?.user?.email ?? null,
      userId: prop.owner_id,
      ids,
      customData: {
        content_name: "listing_agreement",
        ...(prop.pricing_tier ? { plan_tier: prop.pricing_tier } : {}),
        lang: lang ?? "en",
      },
    });
    if (event) await post(event);
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
    if (!allowed(Boolean(prop.is_test), input.livemode)) return;
    const ids = await storedIdentifiers(prop.owner_id);
    if (ids.ads !== "granted") return;
    const [{ data: owner }, lang] = await Promise.all([
      createService().auth.admin.getUserById(prop.owner_id),
      lookupRecipientLang(prop.owner_id),
    ]);
    const event = buildMetaEvent({
      name: "Purchase",
      eventId: metaEventId.purchase(input.propertyId),
      // La hora de la confirmación del pago (esta llamada).
      eventTime: new Date(),
      sourceUrl: listingFlowUrl(SITE_URL, lang ?? "en"),
      email: owner?.user?.email ?? null,
      userId: prop.owner_id,
      ids,
      customData: {
        value: input.value,
        currency: input.currency.toUpperCase(),
        content_type: "product",
        content_ids: [input.tier ?? prop.pricing_tier ?? "plan"],
        lang: lang ?? "en",
      },
    });
    if (event) await post(event);
  } catch (e) {
    console.error(JSON.stringify({ event: "meta_capi_failed", name: "Purchase", message: e instanceof Error ? e.message : "error" }));
  } finally {
    if (ownerId) await forgetIpAndUa(ownerId).catch(() => {});
  }
}

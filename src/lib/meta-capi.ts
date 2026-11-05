// API de Conversiones de Meta (plan de medición del CMO, paso 4.8; decisión del owner
// 2026-10-31). Reglas puras; el envío y la tabla ad_attribution viven en
// meta-capi.server.ts.
//
// Tres eventos de servidor, cada uno una vez por persona o listing (event_id estable):
//   - Lead:                 primera verificación del correo, por cualquier vía (paso 1 del
//                           registro, código o enlace de /sign-up, enlace de acceso, paso 7)
//                                                                         → lead_<user id>
//   - CompleteRegistration: el vendedor principal firma el contrato       → agreement_<listing id>
//   - Purchase:             pago del plan confirmado                      → purchase_<listing id>
//
// Condiciones del owner:
//   - El píxel sigue sin cargar en las rutas sin publicidad (isAdsExcludedPath): esto NO
//     lo cambia. Solo el servidor avisa de esos tres hitos.
//   - Solo con Publicidad "granted" (cookie del momento o la elección guardada) y sin GPC.
//     Sin consentimiento no sale nada: no hay versión anónima.
//   - Solo em y external_id (SHA-256), fbp, fbc, IP y user agent. Nada del inmueble ni del
//     listing, ni nombre ni teléfono. event_source_url sin parámetros.
//   - Apagada en Production (META_CAPI_ENABLED) hasta que el texto de §6.2 esté aprobado y
//     publicado. En Preview, solo con código de Eventos de prueba: el de la URL
//     (?meta_test_code=TEST…, guardado en una cookie) o, si no hay, META_TEST_EVENT_CODE.

import { createHash } from "node:crypto";
import { effectiveConsent, readConsentState, sanitizeUrl } from "@/lib/analytics-config";
import { metaFbc, metaFbp } from "@/lib/ga4-attribution";
import { AD_IP_UA_RETENTION_DAYS } from "@/config/meta";

export type MetaEventName = "Lead" | "CompleteRegistration" | "Purchase";

/** Identificadores de una persona para Meta. Sin Publicidad aceptada, solo el estado. */
export type AdIdentifiers =
  | { ads: "granted"; fbp: string | null; fbc: string | null; clientIp: string | null; clientUa: string | null }
  | { ads: "denied" }
  /** No eligió (sin cookie de consentimiento): no se envía nada y no se pisa lo guardado. */
  | { ads: "unknown" };

function cookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Primer valor de x-forwarded-for, si parece una IP (v4 o v6). */
export function clientIpFrom(xff: string | null): string | null {
  const ip = xff?.split(",")[0]?.trim() ?? "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/** User agent recortado (Meta no necesita más). */
export function clientUaFrom(ua: string | null): string | null {
  const v = ua?.trim() ?? "";
  return v ? v.slice(0, 512) : null;
}

/**
 * Lo que dice la petición del navegador: la cookie de consentimiento (con Global Privacy
 * Control, la Publicidad cuenta como denegada) y, solo con Publicidad aceptada, _fbp,
 * _fbc, IP y user agent.
 */
export function adIdentifiersFromRequest(input: {
  cookieHeader: string | null;
  xForwardedFor: string | null;
  userAgent: string | null;
  gpc: boolean;
}): AdIdentifiers {
  const header = input.cookieHeader ?? "";
  const saved = readConsentState(header);
  if (!saved) return input.gpc ? { ads: "denied" } : { ads: "unknown" };
  const state = effectiveConsent(saved, input.gpc);
  if (state.ads !== "granted") return { ads: "denied" };
  return {
    ads: "granted",
    fbp: metaFbp(cookie(header, "_fbp")),
    fbc: metaFbc(cookie(header, "_fbc")),
    clientIp: clientIpFrom(input.xForwardedFor),
    clientUa: clientUaFrom(input.userAgent),
  };
}

/** SHA-256 en hexadecimal y minúsculas (lo que pide Meta para em y external_id). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Correo normalizado como pide Meta: sin espacios y en minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * ¿Sale el evento? Todas las condiciones a la vez; si falta una, no sale nada.
 *   - META_CAPI_ENABLED = "true", token y conjunto de datos.
 *   - Production: sin código de prueba (nunca se mezclan), listing no is_test y, en un
 *     pago, Stripe livemode.
 *   - Preview: solo con código de prueba (todo va a Eventos de prueba, también is_test).
 *   - Cualquier otro entorno (Development, local): nunca.
 */
export function shouldSendMeta(input: {
  enabled: string | undefined;
  hasConfig: boolean;
  vercelEnv: string | undefined;
  testEventCode: string | undefined;
  propertyIsTest: boolean | null;
  /** Solo en Purchase. */
  livemode?: boolean;
}): boolean {
  if (input.enabled !== "true" || !input.hasConfig) return false;
  const testCode = Boolean(input.testEventCode?.trim());
  if (input.vercelEnv === "production") {
    return !testCode && input.propertyIsTest === false && input.livemode !== false;
  }
  if (input.vercelEnv === "preview") return testCode;
  return false;
}

export type MetaServerEvent = {
  event_name: MetaEventName;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: {
    em?: string[];
    external_id: string[];
    fbp?: string;
    fbc?: string;
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data: Record<string, string | number | string[]>;
};

/**
 * Un evento de servidor. Solo con Publicidad aceptada (si no, null). Cifra el correo y el
 * id del usuario; fbp, fbc, IP y user agent van tal cual. La URL va sin parámetros.
 */
export function buildMetaEvent(input: {
  name: MetaEventName;
  eventId: string;
  eventTime: Date | number;
  sourceUrl: string;
  email: string | null;
  userId: string;
  ids: AdIdentifiers;
  customData: Record<string, string | number | string[]>;
}): MetaServerEvent | null {
  if (input.ids.ads !== "granted") return null;
  const ids = input.ids;
  const time = typeof input.eventTime === "number" ? input.eventTime : Math.floor(input.eventTime.getTime() / 1000);
  const email = input.email ? normalizeEmail(input.email) : "";
  return {
    event_name: input.name,
    event_time: time,
    event_id: input.eventId,
    action_source: "website",
    event_source_url: sanitizeUrl(input.sourceUrl),
    user_data: {
      ...(email ? { em: [sha256Hex(email)] } : {}),
      external_id: [sha256Hex(input.userId)],
      ...(ids.fbp ? { fbp: ids.fbp } : {}),
      ...(ids.fbc ? { fbc: ids.fbc } : {}),
      ...(ids.clientIp ? { client_ip_address: ids.clientIp } : {}),
      ...(ids.clientUa ? { client_user_agent: ids.clientUa } : {}),
    },
    custom_data: input.customData,
  };
}

/** event_id estable de cada hito: un reintento o un segundo envío no cuenta dos veces. */
export const metaEventId = {
  lead: (userId: string) => `lead_${userId}`,
  agreement: (listingId: string) => `agreement_${listingId}`,
  purchase: (listingId: string) => `purchase_${listingId}`,
};

/** El primer idioma válido ("en" o "es") de la lista; si no hay ninguno, inglés. */
export function metaLang(...candidates: unknown[]): "en" | "es" {
  for (const c of candidates) if (c === "en" || c === "es") return c;
  return "en";
}

/** Página de /sign-up (Lead por la creación de cuenta; sin parámetros). */
export function signUpFlowUrl(siteUrl: string, lang: string): string {
  return `${siteUrl.replace(/\/$/, "")}/${lang === "es" ? "es" : "en"}/sign-up`;
}

/**
 * Margen para decidir que una verificación es la PRIMERA del correo: la confirmación
 * (email_confirmed_at) se fija una sola vez, al confirmar; un ingreso posterior por enlace o
 * código la encuentra vieja. Dos vías dentro de este margen mandan el mismo event_id
 * (lead_<user id>) y Meta lo deduplica.
 */
export const EMAIL_JUST_CONFIRMED_MS = 10 * 60 * 1000;

/** ¿Este usuario acaba de confirmar su correo (primera verificación)? */
export function emailJustConfirmed(
  user: { is_anonymous?: boolean; email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined,
  now: Date,
): boolean {
  if (!user || user.is_anonymous === true || !user.email) return false;
  const at = Date.parse(user.email_confirmed_at ?? user.confirmed_at ?? "");
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= -60_000 && age <= EMAIL_JUST_CONFIRMED_MS;
}

/** Página del registro donde ocurre cada hito (sin parámetros: nunca un id). */
export function listingFlowUrl(siteUrl: string, lang: string): string {
  return `${siteUrl.replace(/\/$/, "")}/${lang === "es" ? "es" : "en"}/listing/new`;
}

/**
 * Código de Eventos de prueba por URL, solo en Preview: Meta lo cambia cada vez que se abre
 * Eventos de prueba, así que quien prueba lo pasa con ?meta_test_code=TEST… y el proxy lo
 * guarda en una cookie httpOnly de un día. En Production ni el parámetro ni la cookie se
 * leen ni se escriben.
 */
export const META_TEST_CODE_PARAM = "meta_test_code";
export const META_TEST_CODE_COOKIE = "lx_meta_test";
export const META_TEST_CODE_MAX_AGE = 24 * 60 * 60;

/** "TEST" + dígitos (lo que muestra Eventos de prueba); cualquier otra cosa, null. */
export function validTestEventCode(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  return /^TEST\d{1,12}$/.test(v) ? v : null;
}

/** Qué guardar en la cookie a partir de la URL: solo en Preview y con formato válido. */
export function testCodeFromUrl(vercelEnv: string | undefined, param: string | null): string | null {
  return vercelEnv === "preview" ? validTestEventCode(param) : null;
}

/**
 * Código vigente: en Preview, el de la cookie (válido) y si no, la variable; fuera de
 * Preview, solo la variable (que en Production apaga el envío). `cookieValue` es una
 * función para que fuera de Preview la cookie ni se lea.
 */
export function resolveTestEventCode(input: {
  vercelEnv: string | undefined;
  envValue: string | undefined;
  cookieValue: () => string | null | undefined;
}): { code: string | undefined; source: "cookie" | "env" | null } {
  const env = input.envValue?.trim() || undefined;
  if (input.vercelEnv === "preview") {
    const fromCookie = validTestEventCode(input.cookieValue());
    if (fromCookie) return { code: fromCookie, source: "cookie" };
  }
  return { code: env, source: env ? "env" : null };
}

/** Desde cuándo una IP y un user agent guardados ya no se usan ni se conservan. */
export function ipUaRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - AD_IP_UA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** ¿La IP y el user agent guardados en `savedAt` pasaron el plazo? Sin fecha, sí. */
export function ipUaExpired(savedAt: string | null | undefined, now: Date): boolean {
  const t = savedAt ? Date.parse(savedAt) : Number.NaN;
  return !Number.isFinite(t) || t < ipUaRetentionCutoff(now).getTime();
}

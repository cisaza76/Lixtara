// API de Conversiones de Meta (plan de medición del CMO, paso 4.8; decisión del owner
// 2026-10-31). Reglas puras; el envío y la tabla ad_attribution viven en
// meta-capi.server.ts.
//
// Tres eventos de servidor, cada uno una vez por persona o listing (event_id estable):
//   - Lead:                 correo verificado en el paso 1 del registro   → lead_<user id>
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
//     publicado. En Preview, solo con META_TEST_EVENT_CODE (Eventos de prueba).

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

/** Página del registro donde ocurre cada hito (sin parámetros: nunca un id). */
export function listingFlowUrl(siteUrl: string, lang: string): string {
  return `${siteUrl.replace(/\/$/, "")}/${lang === "es" ? "es" : "en"}/listing/new`;
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

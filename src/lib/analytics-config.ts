// Configuración de analítica (decisión del owner, 2026-10-11):
//   - GA4 vía Google Tag Manager → marketing y adquisición.
//   - PostHog → producto: embudos, abandono, cohortes, feature flags.
// Ninguna de las dos se carga sin el CONSENTIMIENTO del visitante (banner), y sin sus
// variables de entorno no se carga nada: el sitio queda exactamente como antes.
//
// PURO: sin I/O. Lo lee el layout (servidor) y pasa el resultado al banner (cliente).

export const CONSENT_COOKIE = "lx_consent";
export type ConsentChoice = "granted" | "denied";
/** Un año: después se vuelve a preguntar. */
export const CONSENT_MAX_AGE_S = 365 * 24 * 60 * 60;

export interface AnalyticsConfig {
  gtmId: string | null;
  posthogKey: string | null;
  posthogHost: string;
  /** true si hay al menos una herramienta configurada (entonces hay que pedir consentimiento). */
  enabled: boolean;
}

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** Valores con forma inválida se ignoran: mejor no cargar nada que cargar algo raro. */
export function analyticsConfig(env: {
  NEXT_PUBLIC_GTM_ID?: string;
  NEXT_PUBLIC_POSTHOG_KEY?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
}): AnalyticsConfig {
  const gtm = env.NEXT_PUBLIC_GTM_ID?.trim() ?? "";
  const key = env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "";
  const host = env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ?? "";
  const gtmId = /^GTM-[A-Z0-9]{4,12}$/.test(gtm) ? gtm : null;
  const posthogKey = /^phc_[A-Za-z0-9]{20,64}$/.test(key) ? key : null;
  const posthogHost = /^https:\/\/[a-z0-9.-]+$/i.test(host) ? host : DEFAULT_POSTHOG_HOST;
  return { gtmId, posthogKey, posthogHost, enabled: gtmId !== null || posthogKey !== null };
}

/** Lee la elección guardada de un `document.cookie`. null = aún no eligió. */
export function readConsent(cookieHeader: string): ConsentChoice | null {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(granted|denied)(?:;|$)`));
  return m ? (m[1] as ConsentChoice) : null;
}

/**
 * URL sin parámetros ni fragmento: los filtros de búsqueda no son datos personales, pero
 * así ninguna herramienta recibe nada que no necesite (y nunca un identificador de ficha).
 */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

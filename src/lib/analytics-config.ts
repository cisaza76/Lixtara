// Configuración de analítica (decisiones del owner):
//   - 2026-10-11: GA4 vía Google Tag Manager → marketing y adquisición; PostHog → producto.
//   - 2026-10-13: GTM (contenedor del CMO) trae Microsoft Clarity. Modelo OPT-IN en todas las
//     regiones: nada se carga antes de "Aceptar". GTM y PostHog son independientes: cada uno
//     se activa con su propia variable.
//   - 2026-10-15: Google Ads y Meta NO están aprobados. "Aceptar" concede solo analítica
//     (analytics_storage); las señales de publicidad de Consent Mode quedan denegadas, así
//     que una etiqueta de anuncios que quedara en el contenedor no recibe consentimiento.
// Sin variables no se carga nada: el sitio queda exactamente como antes.
//
// PURO: sin I/O. Lo lee el layout (servidor) y pasa el resultado al banner (cliente).

export const CONSENT_COOKIE = "lx_consent";
export type ConsentChoice = "granted" | "denied";
/** Un año: después se vuelve a preguntar. */
export const CONSENT_MAX_AGE_S = 365 * 24 * 60 * 60;

/**
 * Lo que concede "Aceptar" en Consent Mode v2: SOLO analítica (GA4, Clarity). La publicidad
 * (Google Ads, Meta) no está aprobada: sus señales siguen denegadas aunque el visitante acepte.
 */
export const GRANTED_CONSENT = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "granted",
} as const;

/**
 * Cookies que las herramientas dejan en NUESTRO dominio y que se borran al rechazar o retirar
 * el consentimiento: GA4 `_ga*`/`_gid`, Clarity `_clck`/`_clsk`, PostHog `ph_*` y nuestra
 * `lx_ft` (UTM de primer contacto, solo con consentimiento). También `_gcl_*` y `_fbp`/`_fbc`
 * (Google Ads, Meta): no están aprobados, pero si una etiqueta del contenedor los dejara, se borran.
 */
export const ANALYTICS_COOKIE_RE = /^(_ga|_gid|_gcl_|_fbp|_fbc|_clck|_clsk|ph_|lx_ft$)/;

export interface AnalyticsConfig {
  gtmId: string | null;
  posthogKey: string | null;
  posthogHost: string;
  /** true si hay al menos una herramienta bien configurada (entonces hay que pedir consentimiento). */
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
  const posthogHost = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host : DEFAULT_POSTHOG_HOST;
  // Cada herramienta por su lado: una variable con forma inválida se ignora sola, sin apagar
  // la otra. Sin ninguna válida no hay banner, ni carga, ni política con analítica.
  return { gtmId, posthogKey, posthogHost, enabled: gtmId !== null || posthogKey !== null };
}

/**
 * Las herramientas que nombra el banner, según lo configurado. Con GTM entran las del
 * contenedor del CMO aprobadas (GA4 y Clarity); PostHog solo si está su variable.
 */
export function consentTools(c: Pick<AnalyticsConfig, "gtmId" | "posthogKey">, lang: "en" | "es"): string {
  const tools = [
    ...(c.gtmId ? ["Google Analytics", "Microsoft Clarity"] : []),
    ...(c.posthogKey ? ["PostHog"] : []),
  ];
  const and = lang === "es" ? " y " : " and ";
  return tools.length > 1 ? `${tools.slice(0, -1).join(", ")}${and}${tools.at(-1)}` : (tools[0] ?? "");
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

/**
 * Páginas donde la analítica NO corre: el panel de staff (sus URLs llevan ids de leads y
 * de propiedades, y no es audiencia de marketing ni de producto).
 */
export function isAnalyticsExcludedPath(pathname: string): boolean {
  return /^\/(en|es)\/admin(\/|$)/.test(pathname);
}

/**
 * Rutas que Clarity no graba (decisión del owner 2026-10-14, opción "a"): ahí se escriben
 * dirección, correo, contraseña o datos de la cuenta. El contenedor las excluye en la carga
 * de página, pero Clarity no tiene cómo detenerse en una navegación sin recarga: a estas
 * rutas se entra SIEMPRE con carga completa cuando Clarity está activo (RecordingGuard).
 */
export function isRecordingExcludedPath(pathname: string): boolean {
  return /^\/(en|es)\/(listing|account|auth|sign-in|sign-up|dashboard|admin)(\/|$)/.test(pathname);
}

/**
 * Lo que PostHog recibe en cada evento: URLs y referrers sin parámetros ni fragmento, y sin
 * el título de la página (puede nombrar una propiedad). Se usa como `sanitize_properties`.
 */
export function sanitizePosthogProperties(props: Record<string, unknown>): Record<string, unknown> {
  for (const k of ["$current_url", "$referrer", "$initial_referrer", "$initial_current_url"]) {
    if (typeof props[k] === "string" && props[k] !== "$direct") props[k] = sanitizeUrl(props[k] as string) || "$direct";
  }
  delete props.title;
  delete props.$title;
  return props;
}

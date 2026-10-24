// Configuración de analítica (decisiones del owner):
//   - 2026-10-11: GA4 vía Google Tag Manager → marketing y adquisición; PostHog → producto.
//   - 2026-10-13: GTM (contenedor del CMO) trae Microsoft Clarity. Modelo OPT-IN en todas las
//     regiones: nada se carga antes de "Aceptar". GTM y PostHog son independientes: cada uno
//     se activa con su propia variable.
//   - 2026-10-15: Google Ads y Meta NO están aprobados (reemplazado el 2026-10-24).
//   - 2026-10-24: Meta (píxel) y Google Ads SOLO con consentimiento opt-in de la categoría
//     Publicidad, separada de Analítica. Todo denegado por defecto; cada categoría se acepta o
//     rechaza por su lado. En el embudo, la cuenta y el staff (isAdsExcludedPath) las señales
//     de publicidad quedan denegadas aunque haya consentimiento.
// Sin variables no se carga nada: el sitio queda exactamente como antes.
//
// PURO: sin I/O. Lo lee el layout (servidor) y pasa el resultado al banner (cliente).

export const CONSENT_COOKIE = "lx_consent";
export type ConsentChoice = "granted" | "denied";
/** Un año: después se vuelve a preguntar. */
export const CONSENT_MAX_AGE_S = 365 * 24 * 60 * 60;

/** La elección por categoría. */
export interface ConsentState {
  analytics: ConsentChoice;
  ads: ConsentChoice;
}

/**
 * Valor de `lx_consent`: `analytics-<granted|denied>.ads-<granted|denied>`. Los valores de
 * antes del 2026-10-24 (`granted` / `denied`) solo hablaban de analítica: se leen con la
 * publicidad denegada (nunca se pidió) y el banner no vuelve a salir.
 */
export function consentCookieValue(s: ConsentState): string {
  return `analytics-${s.analytics}.ads-${s.ads}`;
}

/** Lee la elección guardada de un `document.cookie` (o del header Cookie). null = aún no eligió. */
export function readConsentState(cookieHeader: string): ConsentState | null {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)`));
  const v = m?.[1]?.trim() ?? "";
  if (v === "granted" || v === "denied") return { analytics: v, ads: "denied" };
  const n = v.match(/^analytics-(granted|denied)\.ads-(granted|denied)$/);
  return n ? { analytics: n[1] as ConsentChoice, ads: n[2] as ConsentChoice } : null;
}

/**
 * Global Privacy Control (decisión del owner 2026-10-24): si el navegador manda la señal
 * (`navigator.globalPrivacyControl === true`, o el header `Sec-GPC: 1` en el servidor), la
 * Publicidad queda denegada aunque la cookie diga otra cosa. La Analítica no cambia.
 */
export function effectiveConsent(s: ConsentState, gpc: boolean): ConsentState {
  return gpc ? { analytics: s.analytics, ads: "denied" } : s;
}

/** ¿El navegador manda Global Privacy Control? (`navigator` o el header `Sec-GPC`). */
export function gpcEnabled(signal: object | string | null | undefined): boolean {
  if (typeof signal === "string" || signal == null) return signal?.trim() === "1";
  return (signal as { globalPrivacyControl?: unknown }).globalPrivacyControl === true;
}

/**
 * Consent Mode v2 para la página actual: analítica según su categoría; las tres señales de
 * publicidad juntas, según Publicidad, y siempre denegadas en las rutas sin publicidad y con
 * Global Privacy Control.
 */
export function consentModeUpdate(s: ConsentState, pathname: string, gpc = false) {
  const ads = s.ads === "granted" && !gpc && !isAdsExcludedPath(pathname) ? "granted" : "denied";
  return {
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
    analytics_storage: s.analytics,
  } as const;
}

/**
 * Cookies de analítica que las herramientas dejan en NUESTRO dominio y que se borran al
 * rechazar o retirar la analítica: GA4 `_ga*`/`_gid`, Clarity `_clck`/`_clsk`, PostHog `ph_*`
 * y nuestra `lx_ft` (UTM de primer contacto, solo con consentimiento).
 */
export const ANALYTICS_COOKIE_RE = /^(_ga|_gid|_clck|_clsk|ph_|lx_ft$)/;

/**
 * Cookies de publicidad en NUESTRO dominio (Google Ads `_gcl_*`, Meta `_fbp`/`_fbc`): se
 * borran al rechazar o retirar la publicidad.
 */
export const ADS_COOKIE_RE = /^(_gcl_|_fbp$|_fbc$)/;

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
 * contenedor del CMO aprobadas (GA4 y Clarity); PostHog solo si está su variable. Clarity va
 * al final, con lo que hace (graba cómo se usan las páginas, con los datos personales ocultos).
 */
export function consentTools(c: Pick<AnalyticsConfig, "gtmId" | "posthogKey">, lang: "en" | "es"): string {
  const clarity =
    lang === "es"
      ? "Microsoft Clarity, que graba cómo se usan las páginas con tu información personal oculta"
      : "Microsoft Clarity, which records how pages are used with personal information hidden";
  const tools = [
    ...(c.gtmId ? ["Google Analytics"] : []),
    ...(c.posthogKey ? ["PostHog"] : []),
    ...(c.gtmId ? [clarity] : []),
  ];
  const and = lang === "es" ? " y " : " and ";
  return tools.length > 1 ? `${tools.slice(0, -1).join(", ")}${and}${tools.at(-1)}` : (tools[0] ?? "");
}

/** La elección de ANALÍTICA guardada en un `document.cookie`. null = aún no eligió. */
export function readConsent(cookieHeader: string): ConsentChoice | null {
  return readConsentState(cookieHeader)?.analytics ?? null;
}

/** La elección de PUBLICIDAD guardada en un `document.cookie`. null = aún no eligió. */
export function readAdsConsent(cookieHeader: string): ConsentChoice | null {
  return readConsentState(cookieHeader)?.ads ?? null;
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
 * Rutas que Clarity no graba. Decisión del owner 2026-10-16 (reemplaza la opción "a" del
 * 2026-10-14): Clarity graba TODO el embudo (páginas públicas, /listing, /auth, /sign-in,
 * /sign-up) con enmascaramiento Estricto, y NO graba el área de cuenta (/account). /admin
 * tampoco (ahí ni siquiera corre la analítica). El contenedor del CMO excluye estas rutas en
 * la carga de página; Clarity no se puede detener en una navegación sin recarga, así que a
 * estas rutas se entra, y de ellas se sale, con carga completa (RecordingGuard).
 */
export function isRecordingExcludedPath(pathname: string): boolean {
  return /^\/(en|es)\/(account|admin)(\/|$)/.test(pathname);
}

/**
 * Rutas sin publicidad (decisión del owner 2026-10-24): el proceso de publicación, la cuenta,
 * el acceso y el registro, el panel del vendedor y el de staff. Ahí ad_storage, ad_user_data
 * y ad_personalization quedan denegadas aunque la persona haya aceptado la publicidad, y el
 * dataLayer lleva `lx_ads_consent: "denied"` para que GTM no dispare Meta ni Google Ads.
 */
export function isAdsExcludedPath(pathname: string): boolean {
  return /^\/(en|es)\/(listing|account|auth|sign-in|sign-up|dashboard|admin)(\/|$)/.test(pathname);
}

/**
 * ¿Ir de `from` a `to` exige carga completa? El consentimiento se aplica al cargar GTM, así
 * que cambiarlo en medio de una visita exige recargar.
 *   - Entrar a una ruta sin grabación: SIEMPRE (Clarity podría estar grabando).
 *   - Salir de una ruta sin grabación: solo con analítica aceptada, para que el contenedor
 *     vuelva a cargar Clarity al regresar al embudo.
 *   - Entrar a una ruta sin publicidad o salir de ella: solo con publicidad aceptada (sin
 *     ella, las señales ya están denegadas en todas partes).
 */
export function needsFullLoad(
  from: string,
  to: string,
  consent: { analytics: boolean; ads: boolean },
): boolean {
  const a = isRecordingExcludedPath(from);
  const b = isRecordingExcludedPath(to);
  if (b && !a) return true;
  if (a && !b && consent.analytics) return true;
  return consent.ads && isAdsExcludedPath(from) !== isAdsExcludedPath(to);
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

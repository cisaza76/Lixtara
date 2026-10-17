// Catálogo ÚNICO de eventos del navegador. Cada evento va a:
//   - `dataLayer` → lo lee Google Tag Manager (GA4: marketing y adquisición);
//   - PostHog → producto (embudos, abandono, cohortes).
// SOLO si el visitante aceptó la analítica en el banner. Antes de eso, o si la rechazó,
// `track()` no hace nada: ningún evento queda encolado para salir después.
//
// Nunca poner datos personales (email, nombre, teléfono, dirección, texto del chat) ni
// contenido o identificadores de fichas del MLS en un evento.
//
// Los eventos COMERCIALES (lead contactado, acuerdo firmado, plan pagado, listing
// publicado) no salen de aquí: se emiten desde el servidor, a partir de cambios de estado
// verificables (src/lib/analytics.server.ts).

import { analyticsConfig, isAnalyticsExcludedPath, readConsent } from "@/lib/analytics-config";
import { FIRST_TOUCH_COOKIE, FIRST_TOUCH_MAX_AGE_S, firstTouchCookieValue } from "@/lib/funnel-events";

export const LISTING_STEP_SLUGS = [
  "address",
  "plan",
  "details",
  "description",
  "photos",
  "review",
  "agreement",
  "payment",
] as const;

export type ListingStepEvent = {
  event: "listing_step_view";
  step: number;
  step_name: string;
  /** Desde el paso 3 (el plan se elige en el 2). */
  plan_tier?: PlanTier;
  lang: string;
};

export type PlanTier = "essentials" | "pro" | "concierge";
/** Dónde está el botón que lleva al registro. */
export type ListingCtaLocation = "header" | "hero" | "pricing" | "footer" | "plan_quiz";
export type ListingResumeSource = "email_link" | "broker_link";

export type ListingStepCompleteEvent = {
  event: "listing_step_complete";
  step: number;
  step_name: string;
  /** Desde el paso 2. */
  plan_tier?: PlanTier;
  /** Solo en el paso 5. */
  photos_count?: number;
  lang: string;
};

export type AnalyticsEvent =
  // Embudo vendedor
  | ListingStepEvent
  | { event: "email_verified"; method: "listing_gate" | "account"; lang: string }
  | { event: "listing_cta_click"; location: ListingCtaLocation; tier?: PlanTier; lang: string }
  | ListingStepCompleteEvent
  | { event: "listing_step_error"; step: number; field: string; lang: string }
  | { event: "listing_resumed"; step: number; source: ListingResumeSource; lang: string }
  | { event: "agreement_signed"; plan_tier?: PlanTier; lang: string }
  | { event: "begin_checkout"; plan_tier: PlanTier; value: number; currency: "USD"; lang: string }
  // buyer_commission_pct: the % for a percentage offer, 0 for no offer, null for a fixed amount
  // (the amount itself is never sent).
  | {
      event: "calculator_used";
      home_price_range: HomePriceRange;
      buyer_comp_type: "none" | "percent" | "amount";
      buyer_commission_pct: number | null;
      lang: string;
    }
  // Embudo comprador
  | {
      event: "property_search";
      lang: string;
      page: number;
      sort: string;
      has_price: boolean;
      has_beds: boolean;
      has_baths: boolean;
      county: string | null;
      has_zip: boolean;
      results_bucket: "0" | "1-24" | "25-100" | "100+";
    }
  | { event: "property_open"; lang: string; source: "own" }
  | { event: "showing_request_started"; lang: string; target: "own" | "mls" }
  | { event: "showing_request_submitted"; lang: string; target: "own" | "mls"; exclusive: boolean }
  // Contacto y asistente
  | { event: "loui_open"; lang: string }
  | { event: "loui_message_sent"; message_index: number; lang: string }
  | { event: "contact_form_submitted"; topic: string; lang: string }
  | { event: "whatsapp_click"; location: string; lang: string }
  | { event: "phone_click"; location: string; lang: string };

/** Event for viewing step `step` (1-based) of /listing/new. Step names are stable English slugs. */
export function listingStepEvent(step: number, lang: string, planTier?: string | null): ListingStepEvent {
  const slug = LISTING_STEP_SLUGS[step - 1] ?? `step_${step}`;
  const e: ListingStepEvent = { event: "listing_step_view", step, step_name: slug, lang };
  if (step >= 3 && isPlanTier(planTier)) e.plan_tier = planTier;
  return e;
}

export type HomePriceRange = "200-400k" | "400-600k" | "600-800k" | "800k-1m" | "1-1.5m" | "1.5-2m";

/** Rango del precio de la calculadora (200k–2M): nunca el valor exacto. */
export function homePriceRange(price: number): HomePriceRange {
  if (price < 400_000) return "200-400k";
  if (price < 600_000) return "400-600k";
  if (price < 800_000) return "600-800k";
  if (price < 1_000_000) return "800k-1m";
  if (price < 1_500_000) return "1-1.5m";
  return "1.5-2m";
}

export function isPlanTier(v: unknown): v is PlanTier {
  return v === "essentials" || v === "pro" || v === "concierge";
}

/** Paso `step` terminado (validado y guardado). plan_tier desde el paso 2; fotos solo en el 5. */
export function listingStepCompleteEvent(input: {
  step: number;
  lang: string;
  planTier?: string | null;
  photosCount?: number;
}): ListingStepCompleteEvent {
  const e: ListingStepCompleteEvent = {
    event: "listing_step_complete",
    step: input.step,
    step_name: LISTING_STEP_SLUGS[input.step - 1] ?? `step_${input.step}`,
    lang: input.lang,
  };
  if (input.step >= 2 && isPlanTier(input.planTier)) e.plan_tier = input.planTier;
  if (input.step === 5 && input.photosCount !== undefined) e.photos_count = input.photosCount;
  return e;
}

// Error de validación de /listing/new (código de ?error=) → nombre del campo. Solo errores
// de lo que la persona llenó; los fallos del sistema (save_failed, upload_failed…) no son
// fricción del formulario y no se reportan.
const STEP_ERROR_FIELDS: Record<string, string> = {
  required: "required_fields",
  fl_only: "state",
  address_invalid: "address",
  email: "email",
  email_exists: "email",
  captcha: "captcha",
  invalid_type: "property_type",
  invalid_beds: "bedrooms",
  invalid_baths: "bathrooms",
  invalid_sqft: "sqft",
  invalid_year: "year_built",
  invalid_price: "list_price",
  invalid_parking: "parking_spaces",
  invalid_hoa: "hoa_fee",
  invalid_tax: "tax_annual_amount",
  invalid: "description",
  empty_improve: "description",
  no_files: "photos",
  not_enough: "photos",
  rights_required: "photo_rights",
  buyer_comp_choice_required: "buyer_agent_comp",
  buyer_comp_pct_range: "buyer_agent_comp",
  buyer_comp_amount_range: "buyer_agent_comp",
};

export function listingErrorField(code: string | null | undefined): string | null {
  return (code && Object.hasOwn(STEP_ERROR_FIELDS, code) && STEP_ERROR_FIELDS[code]) || null;
}

/** Cubo de resultados: el número exacto no aporta y así nada se parece a un inventario. */
export function resultsBucket(total: number): "0" | "1-24" | "25-100" | "100+" {
  if (total <= 0) return "0";
  if (total <= 24) return "1-24";
  if (total <= 100) return "25-100";
  return "100+";
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

interface CaptureClient {
  capture(event: string, properties?: Record<string, unknown>): void;
}

// Estado de la página. null = el banner aún no se inicializó: entonces manda la cookie
// (una página puede emitir eventos antes de que el banner monte).
let consentState: boolean | null = null;
let posthogClient: CaptureClient | null = null;
// Eventos de PostHog mientras su SDK carga (SOLO con consentimiento ya dado; se vacía al
// cargar y se descarta al retirar el consentimiento).
const pendingForPosthog: Array<[string, Record<string, unknown>]> = [];
const PENDING_MAX = 50;

/** Lo llama el banner al aceptar (y al cargar la página si ya había aceptado). */
export function enableAnalytics(client: CaptureClient | null): void {
  consentState = true;
  posthogClient = client;
  captureFirstTouch();
  if (client) for (const [event, props] of pendingForPosthog.splice(0)) client.capture(event, props);
}

/** Lo llama el banner al rechazar o al retirar el consentimiento. */
export function disableAnalytics(): void {
  consentState = false;
  posthogClient = null;
  pendingForPosthog.length = 0;
  waitingForPageview.length = 0;
}

export function analyticsEnabled(): boolean {
  return consentState === true;
}

// ¿Este build tiene la analítica configurada? Variables NEXT_PUBLIC_ escritas literalmente
// para que Next las incruste. Sin ninguna herramienta, track() no hace nada, aunque quede una
// cookie de consentimiento de una activación anterior.
const BUILD_CONFIG = analyticsConfig({
  NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});
const CONFIGURED = BUILD_CONFIG.enabled;

function granted(): boolean {
  if (!CONFIGURED) return false;
  if (consentState !== null) return consentState;
  try {
    return readConsent(document.cookie) === "granted";
  } catch {
    return false;
  }
}

export function track(e: AnalyticsEvent): void {
  if (typeof window === "undefined" || !granted()) return;
  const path = window.location?.pathname ?? "";
  if (isAnalyticsExcludedPath(path)) return;
  // Con GTM, el lx_page_view de cada ruta va primero: los eventos que la página emite antes
  // (sus efectos corren antes que el del banner) esperan a markPageview, como máximo 3 s.
  if (BUILD_CONFIG.gtmId && pageviewPath !== path) {
    if (waitingForPageview.length < PENDING_MAX) waitingForPageview.push(e);
    if (!pageviewTimer) pageviewTimer = setTimeout(flushWaiting, PAGEVIEW_WAIT_MS);
    return;
  }
  send(e);
}

function send(e: AnalyticsEvent): void {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(e);
  const { event, ...props } = e;
  if (posthogClient) posthogClient.capture(event, props);
  // Retener solo si PostHog va a cargar: con GTM solo, no hay a quién entregárselos.
  else if (BUILD_CONFIG.posthogKey && pendingForPosthog.length < PENDING_MAX) pendingForPosthog.push([event, props]);
}

// Ruta del último lx_page_view enviado, y lo que espera a que salga.
let pageviewPath: string | null = null;
const waitingForPageview: AnalyticsEvent[] = [];
let pageviewTimer: ReturnType<typeof setTimeout> | null = null;
const PAGEVIEW_WAIT_MS = 3000;

function flushWaiting(): void {
  if (pageviewTimer) clearTimeout(pageviewTimer);
  pageviewTimer = null;
  const events = waitingForPageview.splice(0);
  if (!granted()) return;
  for (const e of events) send(e);
}

/** Lo llama el banner justo después de empujar lx_page_view de `path`. */
export function markPageview(path: string): void {
  pageviewPath = path;
  flushWaiting();
}

/**
 * Como track(), y luego `done`: para eventos justo antes de salir de la página (Stripe).
 * Con GTM cargado, `done` corre en el eventCallback; sin consentimiento, sin GTM o si GTM no
 * responde, corre igual a los `timeoutMs`. Siempre una sola vez.
 */
export function trackThen(e: AnalyticsEvent, done: () => void, timeoutMs = 1000): void {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    done();
  };
  const gtm = typeof window !== "undefined" && granted() && !isAnalyticsExcludedPath(window.location?.pathname ?? "")
    && BUILD_CONFIG.gtmId;
  if (!gtm) {
    track(e);
    once();
    return;
  }
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ ...e, eventCallback: once, eventTimeout: timeoutMs });
  const { event, ...props } = e;
  if (posthogClient) posthogClient.capture(event, props);
  setTimeout(once, timeoutMs + 100);
}

/**
 * UTM de primer contacto: con consentimiento, si la URL trae utm_* y aún no hay cookie, se
 * guardan en lx_ft para que el paso 1 las registre. Primer contacto = no se sobrescribe.
 * Al rechazar o retirar el consentimiento el banner borra la cookie (ANALYTICS_COOKIE_RE).
 */
function captureFirstTouch(): void {
  try {
    if (new RegExp(`(?:^|;\\s*)${FIRST_TOUCH_COOKIE}=`).test(document.cookie)) return;
    const value = firstTouchCookieValue(new URLSearchParams(window.location.search));
    if (!value) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${FIRST_TOUCH_COOKIE}=${value}; Max-Age=${FIRST_TOUCH_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* cookies bloqueadas: sin UTM */
  }
}

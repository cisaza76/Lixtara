// Reglas puras del embudo del vendedor en Supabase (funnel_events → listing_funnel_v).
// La escritura vive en funnel-events.server.ts; aquí lo que se puede probar sin base.

export type FunnelEventName =
  | "listing_step_complete"
  | "agreement_signed"
  | "broker_countersigned"
  | "checkout_started"
  | "listing_paid"
  | "listing_resumed";

/**
 * ¿Es un evento de prueba? Preview y desarrollo comparten la base de producción y la tabla
 * no se edita, así que se decide al escribir: cualquier entorno que no sea Production, una
 * propiedad marcada is_test o un pago de Stripe en modo de prueba.
 */
export function funnelIsTest(input: {
  vercelEnv: string | undefined;
  propertyIsTest: boolean | null;
  livemode?: boolean;
}): boolean {
  if (input.vercelEnv !== "production") return true;
  if (input.propertyIsTest !== false) return true; // desconocida = no contamina el tablero
  if (input.livemode === false) return true;
  return false;
}

const KEYS = new Set([
  "lang",
  "plan_tier",
  "photos_count",
  "amount",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
]);
const SAFE_TEXT = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Metadata con claves conocidas y valores de forma cerrada: textos en minúsculas sin
 * espacios ni "@" (nada que pueda ser un correo, un nombre o una dirección) y números
 * finitos. Lo demás se descarta en silencio.
 */
export function sanitizeFunnelMetadata(
  metadata: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (SAFE_TEXT.test(s)) out[k] = s;
    }
  }
  return out;
}

// --- UTM de primer contacto -------------------------------------------------------------
// El navegador las guarda en la cookie lx_ft SOLO con consentimiento (analytics.ts); el
// paso 1 las lee del lado del servidor. Formato: source|medium|campaign, cada parte ya
// saneada. Sin consentimiento no hay cookie y las columnas quedan vacías.

export const FIRST_TOUCH_COOKIE = "lx_ft";
export const FIRST_TOUCH_MAX_AGE_S = 90 * 24 * 60 * 60;

function cleanUtm(v: string | null | undefined): string {
  const s = (v ?? "").trim().toLowerCase().replace(/\s+/g, "_").slice(0, 64);
  return SAFE_TEXT.test(s) ? s : "";
}

/** Valor de la cookie a partir de los parámetros de la URL; null si no hay ninguna UTM. */
export function firstTouchCookieValue(params: URLSearchParams): string | null {
  const parts = ["utm_source", "utm_medium", "utm_campaign"].map((k) => cleanUtm(params.get(k)));
  return parts.some(Boolean) ? parts.join("|") : null;
}

/**
 * UTM de la URL actual como campos de campaña de GA4 (campaign_source, campaign_medium,
 * campaign_name), con la misma limpieza que la cookie. Van en lx_page_view como campos
 * aparte: page_location sigue sin parámetros. Vacío si la URL no trae UTM.
 */
export function campaignFields(params: URLSearchParams): {
  campaign_source?: string;
  campaign_medium?: string;
  campaign_name?: string;
} {
  const source = cleanUtm(params.get("utm_source"));
  const medium = cleanUtm(params.get("utm_medium"));
  const name = cleanUtm(params.get("utm_campaign"));
  return {
    ...(source ? { campaign_source: source } : {}),
    ...(medium ? { campaign_medium: medium } : {}),
    ...(name ? { campaign_name: name } : {}),
  };
}

export function parseFirstTouch(value: string | undefined): {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
} {
  if (!value) return {};
  const [source, medium, campaign] = value.split("|").map((p) => cleanUtm(p));
  return {
    ...(source ? { utm_source: source } : {}),
    ...(medium ? { utm_medium: medium } : {}),
    ...(campaign ? { utm_campaign: campaign } : {}),
  };
}

// --- Visitas a páginas de campaña (sin listing) ---------------------------------------
// Un conteo propio, sin consentimiento porque no lleva identificadores: ni usuario, ni
// sesión, ni listing, ni UTM; solo el idioma. property_id null = no entra a listing_funnel_v.

export type PageViewEventName = "owners_landing_view";

// Bots, escáneres de enlaces de correo (Safe Links, Mimecast, Proofpoint…), vistas previas y
// clientes HTTP. Contarlos inflaría las visitas de cada envío.
const AUTOMATED_UA =
  /bot|crawl|spider|slurp|preview|scan|monitor|safe ?links|mimecast|proofpoint|barracuda|headless|lighthouse|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|undici/i;

/** ¿La visita es de un navegador real? Sin user-agent o con prefetch, no se cuenta. */
export function isHumanPageView(input: { userAgent: string | null; purpose: string | null }): boolean {
  const ua = (input.userAgent ?? "").trim();
  if (!ua || AUTOMATED_UA.test(ua)) return false;
  if (input.purpose && /prefetch|prerender/i.test(input.purpose)) return false;
  return true;
}

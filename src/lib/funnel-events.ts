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

// --- Primer contacto: UTM e identificadores de clic de Google Ads ------------------------
// El navegador los guarda en la cookie lx_ft (analytics.ts, syncFirstTouch), cada parte con
// SU categoría (pedido del CMO 2026-11-02):
//   - source|medium|campaign (UTM): solo con Analítica aceptada; el paso 1 las registra.
//   - gclid|gbraid|wbraid (parámetros de la URL de llegada): solo con Publicidad aceptada y
//     sin GPC; el Checkout los lleva a la metadata de Stripe (antes que _gcl_aw / _gcl_gb).
// Formato: source|medium|campaign[|gclid|gbraid|wbraid], cada parte ya saneada. Nada se
// guarda antes del consentimiento: si acepta en la página de llegada, se toman de la URL en
// ese momento. Al denegar una categoría se borra su parte; sin ninguna, la cookie.

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

export type AdClickIds = { gclid?: string; gbraid?: string; wbraid?: string };
const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid"] as const;
const CLICK_ID = /^[A-Za-z0-9_-]{1,400}$/;

function cleanClickId(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return CLICK_ID.test(s) ? s : "";
}

/** gclid, gbraid y wbraid guardados en lx_ft (vacío si no hay). */
export function parseFirstTouchClickIds(value: string | null | undefined): AdClickIds {
  const parts = (value ?? "").split("|").slice(3, 6);
  const out: AdClickIds = {};
  CLICK_ID_KEYS.forEach((k, i) => {
    const v = cleanClickId(parts[i]);
    if (v) out[k] = v;
  });
  return out;
}

/**
 * Nuevo valor de lx_ft según la elección vigente (ya con GPC aplicado): conserva lo que ya
 * había de cada categoría aceptada (primer contacto) y, si falta, lo toma de la URL actual;
 * borra la parte de una categoría denegada. null = borrar la cookie.
 */
export function nextFirstTouchCookie(
  prev: string | null | undefined,
  params: URLSearchParams,
  consent: { analytics: "granted" | "denied"; ads: "granted" | "denied" },
): string | null {
  const old = (prev ?? "").split("|");
  const oldUtm = old.slice(0, 3).map((p) => cleanUtm(p));
  while (oldUtm.length < 3) oldUtm.push("");
  const utm =
    consent.analytics !== "granted"
      ? ["", "", ""]
      : oldUtm.some(Boolean)
        ? oldUtm
        : (firstTouchCookieValue(params)?.split("|") ?? ["", "", ""]);
  const clicks = CLICK_ID_KEYS.map((k, i) =>
    consent.ads === "granted" ? cleanClickId(old[3 + i]) || cleanClickId(params.get(k)) : "",
  );
  if (!utm.some(Boolean) && !clicks.some(Boolean)) return null;
  return clicks.some(Boolean) ? [...utm, ...clicks].join("|") : utm.join("|");
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

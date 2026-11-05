// Compras en GA4 por Measurement Protocol (aprobado por el owner 2026-10-14, punto 4 del plan
// del CMO). Reglas puras; el envío vive en ga4-mp.server.ts.
//
// Al crear el Checkout de Stripe se guardan en su metadata SOLO: idioma, estado de cada
// categoría de consentimiento y:
//   - con Analítica aceptada: el client_id y el session_id de GA4 (cookies _ga y _ga_<id>);
//   - con Publicidad aceptada (decisión del owner 2026-10-24): _fbp y _fbc (Meta) y el gclid
//     (de la cookie _gcl_aw de Google Ads). Sin Publicidad, ninguno de los tres. Con Global
//     Privacy Control (header Sec-GPC: 1), la Publicidad cuenta como denegada.
// El webhook envía `purchase` solo si: analítica "granted" + Production + Stripe livemode +
// propiedad no is_test.

import { effectiveConsent, readConsentState } from "@/lib/analytics-config";

export type CheckoutAttribution = {
  lang: string;
  /** Analítica (se llama `consent` desde antes de que existiera Publicidad). */
  consent: "granted" | "denied" | "unknown";
  ads_consent: "granted" | "denied" | "unknown";
  ga_client_id?: string;
  ga_session_id?: string;
  fbp?: string;
  fbc?: string;
  gclid?: string;
};

function cookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** `_ga` = GA1.1.<rand>.<ts> → client_id "<rand>.<ts>". */
export function gaClientId(value: string | null): string | null {
  const m = value?.match(/^GA\d\.\d+\.(\d{1,20}\.\d{1,20})$/);
  return m ? m[1] : null;
}

/** `_ga_<id>`: GS1.1.<session>.… o GS2.1.s<session>$o…$g… → session_id. */
export function gaSessionId(value: string | null): string | null {
  const m = value?.match(/^GS1\.\d+\.(\d{1,20})\./) ?? value?.match(/^GS2\.\d+\.s(\d{1,20})(?:\$|$)/);
  return m ? m[1] : null;
}

/** `_fbp` = fb.<subdominio>.<creación>.<aleatorio> (formato de Meta). */
export function metaFbp(value: string | null): string | null {
  return value?.match(/^fb\.\d\.\d{10,13}\.\d{1,20}$/) ? value : null;
}

/** `_fbc` = fb.<subdominio>.<creación>.<fbclid> (formato de Meta). */
export function metaFbc(value: string | null): string | null {
  return value?.match(/^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,400}$/) ? value : null;
}

/** `_gcl_aw` = GCL.<ts>.<gclid> → gclid. */
export function googleGclid(value: string | null): string | null {
  return value?.match(/^GCL\.\d{1,13}\.([A-Za-z0-9_-]{1,400})$/)?.[1] ?? null;
}

/** Lo que va a la metadata del Checkout. Cada identificador solo con su categoría aceptada. */
export function checkoutAttribution(
  cookieHeader: string | null,
  measurementId: string | undefined,
  lang: string,
  gpc = false,
): CheckoutAttribution {
  const header = cookieHeader ?? "";
  const saved = readConsentState(header);
  const state = saved ? effectiveConsent(saved, gpc) : null;
  const consent = state?.analytics ?? "unknown";
  const ads = state?.ads ?? "unknown";
  const out: CheckoutAttribution = { lang: lang === "es" ? "es" : "en", consent, ads_consent: ads };
  if (consent === "granted") {
    const clientId = gaClientId(cookie(header, "_ga"));
    if (clientId) out.ga_client_id = clientId;
    const streamId = measurementId?.match(/^G-([A-Z0-9]{4,20})$/)?.[1];
    const sessionId = streamId ? gaSessionId(cookie(header, `_ga_${streamId}`)) : null;
    if (sessionId) out.ga_session_id = sessionId;
  }
  if (ads === "granted") {
    const fbp = metaFbp(cookie(header, "_fbp"));
    if (fbp) out.fbp = fbp;
    const fbc = metaFbc(cookie(header, "_fbc"));
    if (fbc) out.fbc = fbc;
    const gclid = googleGclid(cookie(header, "_gcl_aw"));
    if (gclid) out.gclid = gclid;
  }
  return out;
}

export type PurchaseItem = { item_id: string; item_category: "plan" | "service" };

/** Producto del Checkout, por su metadata (kind / tier). */
export function purchaseItem(metadata: Record<string, string> | null | undefined): PurchaseItem | null {
  const kind = metadata?.kind;
  if (kind === "consultation") return { item_id: "consultation", item_category: "service" };
  if (kind === "photography") return { item_id: "photography", item_category: "service" };
  if (kind === "staging_overage") return { item_id: "staging", item_category: "service" };
  const tier = metadata?.tier;
  if (!kind && (tier === "essentials" || tier === "pro" || tier === "concierge")) {
    return { item_id: tier, item_category: "plan" };
  }
  return null;
}

/** ¿Se envía `purchase`? Todas las condiciones a la vez; si falta una, no sale nada. */
export function shouldSendPurchase(input: {
  vercelEnv: string | undefined;
  livemode: boolean;
  consent: string | undefined;
  clientId: string | undefined;
  propertyIsTest: boolean | null;
  hasConfig: boolean;
}): boolean {
  return (
    input.hasConfig &&
    input.vercelEnv === "production" &&
    input.livemode === true &&
    input.consent === "granted" &&
    !!input.clientId &&
    input.propertyIsTest === false
  );
}

export function purchasePayload(input: {
  clientId: string;
  /** Publicidad aceptada al abrir el Checkout (metadata `ads_consent`). */
  adsConsent: string | undefined;
  sessionId?: string;
  transactionId: string;
  value: number;
  currency: string;
  item: PurchaseItem;
}) {
  return {
    client_id: input.clientId,
    // Analítica aceptada (si no, no se llega aquí); las señales de publicidad, según Publicidad.
    consent: {
      ad_user_data: input.adsConsent === "granted" ? "GRANTED" : "DENIED",
      ad_personalization: input.adsConsent === "granted" ? "GRANTED" : "DENIED",
    },
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: input.transactionId,
          value: input.value,
          currency: input.currency.toUpperCase(),
          ...(input.sessionId ? { session_id: input.sessionId } : {}),
          engagement_time_msec: 1,
          items: [
            {
              item_id: input.item.item_id,
              item_name: input.item.item_id,
              item_category: input.item.item_category,
              price: input.value,
              quantity: 1,
            },
          ],
        },
      },
    ],
  };
}

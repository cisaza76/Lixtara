// Compras en GA4 por Measurement Protocol (aprobado por el owner 2026-10-14, punto 4 del plan
// del CMO). Reglas puras; el envío vive en ga4-mp.server.ts.
//
// Al crear el Checkout de Stripe se guardan en su metadata SOLO: idioma, estado del
// consentimiento y, si la persona aceptó, el client_id y el session_id de GA4 (de las cookies
// _ga y _ga_<id>). Nada de _fbp, _fbc ni gclid. El webhook envía `purchase` solo si:
// consentimiento "granted" + Production + Stripe livemode + propiedad no is_test.

import { readConsent } from "@/lib/analytics-config";

export type CheckoutAttribution = {
  lang: string;
  consent: "granted" | "denied" | "unknown";
  ga_client_id?: string;
  ga_session_id?: string;
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

/** Lo que va a la metadata del Checkout. Los ids de GA4 solo con consentimiento. */
export function checkoutAttribution(
  cookieHeader: string | null,
  measurementId: string | undefined,
  lang: string,
): CheckoutAttribution {
  const header = cookieHeader ?? "";
  const consent = readConsent(header) ?? "unknown";
  const out: CheckoutAttribution = { lang: lang === "es" ? "es" : "en", consent };
  if (consent !== "granted") return out;
  const clientId = gaClientId(cookie(header, "_ga"));
  if (clientId) out.ga_client_id = clientId;
  const streamId = measurementId?.match(/^G-([A-Z0-9]{4,20})$/)?.[1];
  const sessionId = streamId ? gaSessionId(cookie(header, `_ga_${streamId}`)) : null;
  if (sessionId) out.ga_session_id = sessionId;
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
  sessionId?: string;
  transactionId: string;
  value: number;
  currency: string;
  item: PurchaseItem;
}) {
  return {
    client_id: input.clientId,
    // La persona aceptó todo (analítica y publicidad, opt-in): se respeta igual del lado de GA4.
    consent: { ad_user_data: "GRANTED", ad_personalization: "GRANTED" },
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

import Stripe from "stripe";
import {
  PRICING_TIERS,
  PHOTOGRAPHY_ADDON_PRICE,
  type PricingTierId,
} from "@/lib/pricing-tiers";
import {
  CONSULTATION_PRODUCTS,
  type ConsultationProduct,
} from "@/lib/consultations";
import { STAGING_OVERAGE_PRICE, STAGING_MAX_PURCHASE } from "@/lib/staging";

function apiKey(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("STRIPE_SECRET_KEY not configured");
  return k;
}

let _client: Stripe | null = null;
function client(): Stripe {
  if (!_client) {
    _client = new Stripe(apiKey(), {
      // Pinning the version protects us from breaking changes when Stripe
      // promotes a new release. Bump deliberately after testing.
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _client;
}

/** Page language: sets Stripe Checkout's UI language and our product names. */
type CheckoutLang = "en" | "es";

// Product names/descriptions shown on Stripe Checkout and the receipt, in the
// language of the page the buyer came from. Omitted lang ⇒ English + Stripe "auto".
function checkoutLocale(lang: CheckoutLang | undefined): { locale?: "en" | "es" } {
  return lang ? { locale: lang } : {};
}

const CONSULTATION_NAME_ES: Record<ConsultationProduct, string> = {
  best_value: "Paquete Mejor Valor (15 h Realtor + 1 h abogado)",
  realtor_1: "Consulta con Realtor (1 hora)",
  realtor_5: "Consulta con Realtor (5 horas)",
  realtor_10: "Consulta con Realtor (10 horas)",
  attorney_1: "Consulta con abogado (1 hora)",
};

export interface CreateTierCheckoutInput {
  tier: PricingTierId;
  lang?: CheckoutLang;
  propertyId: string;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface TierCheckoutResult {
  sessionId: string;
  url: string;
}

function tierDisplayName(id: PricingTierId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export async function createTierCheckoutSession(
  input: CreateTierCheckoutInput,
): Promise<TierCheckoutResult> {
  const tier = PRICING_TIERS[input.tier];
  const amountCents = tier.flatFee * 100;
  const isEs = input.lang === "es";

  const session = await client().checkout.sessions.create({
    mode: "payment",
    ...checkoutLocale(input.lang),
    customer_email: input.userEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: isEs
              ? `Listing Lixtara ${tierDisplayName(input.tier)} (tarifa fija)`
              : `Lixtara ${tierDisplayName(input.tier)} listing (flat fee)`,
            description: isEs
              ? `Listing por ${tier.termMonths} meses · +${tier.commissionPct}% de comisión Lixtara al cierre.`
              : `${tier.termMonths}-month listing term · +${tier.commissionPct}% Lixtara commission at closing.`,
          },
        },
      },
    ],
    payment_intent_data: {
      // Statement descriptor must be ≤22 chars per Stripe + uppercase ASCII.
      statement_descriptor_suffix: "LISTING FEE",
    },
    metadata: {
      property_id: input.propertyId,
      tier: input.tier,
      user_id: input.userId,
    },
    // successUrl already carries query params (?step=8&id=...), so append the
    // session id with the correct separator — using "?" here produced a
    // malformed double-"?" URL that broke the return-from-Stripe page.
    success_url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe returned a session without a redirect URL");
  }

  return { sessionId: session.id, url: session.url };
}

export interface ConsultationCheckoutInput {
  product: ConsultationProduct;
  lang?: CheckoutLang;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createConsultationCheckoutSession(
  input: ConsultationCheckoutInput,
): Promise<TierCheckoutResult> {
  const p = CONSULTATION_PRODUCTS[input.product];
  const productName = input.lang === "es" ? CONSULTATION_NAME_ES[input.product] : p.name;
  const session = await client().checkout.sessions.create({
    mode: "payment",
    ...checkoutLocale(input.lang),
    customer_email: input.userEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: p.amount * 100,
          product_data: { name: `Lixtara ${productName}` },
        },
      },
    ],
    payment_intent_data: { statement_descriptor_suffix: "CONSULT" },
    // kind=consultation tells the webhook to grant hour tokens (not list a property).
    metadata: {
      kind: "consultation",
      product: input.product,
      user_id: input.userId,
      realtor_hours: String(p.realtorHours),
      attorney_hours: String(p.attorneyHours),
    },
    success_url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) {
    throw new Error("Stripe returned a session without a redirect URL");
  }
  return { sessionId: session.id, url: session.url };
}

export interface PhotographyCheckoutInput {
  propertyId: string;
  lang?: CheckoutLang;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createPhotographyCheckoutSession(
  input: PhotographyCheckoutInput,
): Promise<TierCheckoutResult> {
  const isEs = input.lang === "es";
  const session = await client().checkout.sessions.create({
    mode: "payment",
    ...checkoutLocale(input.lang),
    customer_email: input.userEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PHOTOGRAPHY_ADDON_PRICE * 100,
          product_data: {
            name: isEs ? "Fotografía profesional Lixtara" : "Lixtara professional photography",
            description: isEs
              ? "Servicio adicional de fotografía profesional para tu listing."
              : "Professional listing photography add-on.",
          },
        },
      },
    ],
    payment_intent_data: { statement_descriptor_suffix: "PHOTOGRAPHY" },
    // kind=photography tells the webhook to mark the add-on paid (no listing flip).
    metadata: {
      kind: "photography",
      property_id: input.propertyId,
      user_id: input.userId,
    },
    success_url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) {
    throw new Error("Stripe returned a session without a redirect URL");
  }
  return { sessionId: session.id, url: session.url };
}

export interface StagingOverageCheckoutInput {
  /** number of extra staging actions to buy ($STAGING_OVERAGE_PRICE each) */
  quantity: number;
  lang?: CheckoutLang;
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createStagingOverageCheckoutSession(
  input: StagingOverageCheckoutInput,
): Promise<TierCheckoutResult> {
  const qty = Math.max(1, Math.min(STAGING_MAX_PURCHASE, Math.floor(input.quantity)));
  const isEs = input.lang === "es";
  const session = await client().checkout.sessions.create({
    mode: "payment",
    ...checkoutLocale(input.lang),
    customer_email: input.userEmail,
    line_items: [
      {
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: STAGING_OVERAGE_PRICE * 100,
          product_data: {
            name: isEs
              ? "Staging virtual con IA de Lixtara (habitación adicional)"
              : "Lixtara AI virtual staging (extra room)",
            description: isEs
              ? "Una foto adicional con staging de IA, además de tu cuota gratis."
              : "One additional AI-staged photo beyond your free quota.",
          },
        },
      },
    ],
    payment_intent_data: { statement_descriptor_suffix: "STAGING" },
    // kind=staging_overage tells the webhook to grant `credits` staging credits.
    metadata: {
      kind: "staging_overage",
      user_id: input.userId,
      credits: String(qty),
    },
    success_url: `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) {
    throw new Error("Stripe returned a session without a redirect URL");
  }
  return { sessionId: session.id, url: session.url };
}

export async function getCheckoutSession(
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  return client().checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  if (!signatureHeader) throw new Error("Missing stripe-signature header");
  return client().webhooks.constructEvent(rawBody, signatureHeader, secret);
}

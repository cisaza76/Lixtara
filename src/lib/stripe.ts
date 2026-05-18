import Stripe from "stripe";
import {
  PRICING_TIERS,
  type PricingTierId,
} from "@/lib/pricing-tiers";

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

export interface CreateTierCheckoutInput {
  tier: PricingTierId;
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

  const session = await client().checkout.sessions.create({
    mode: "payment",
    customer_email: input.userEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Lixtara ${tierDisplayName(input.tier)} listing — flat fee`,
            description: `${tier.termMonths}-month listing term · +${tier.commissionPct}% Lixtara commission at closing.`,
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
    success_url: `${input.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
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
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  if (!signatureHeader) throw new Error("Missing stripe-signature header");
  return client().webhooks.constructEvent(rawBody, signatureHeader, secret);
}

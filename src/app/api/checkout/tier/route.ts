// POST /api/checkout/tier
// Body (JSON): { property_id, lang? }
//
// Creates a Stripe Checkout Session for the property's tier flat fee.
// Persists a `payments` row in 'pending' status with the session id. Returns
// the Stripe redirect URL — client navigates there.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTierCheckoutSession } from "@/lib/stripe";
import { PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

interface Body {
  property_id?: string;
  lang?: string;
}

const TIERS = new Set<string>(["essentials", "pro", "concierge"]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  // Each call creates a Stripe Checkout session — cap per user.
  const limited = await enforceLimit(
    apiLimiter("checkout:tier", 20, "1 h"),
    `u:${user.id}`,
    {
      label: "checkout:tier",
      message:
        "Too many checkout attempts. Please wait a few minutes and try again.",
    },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const propertyId = body.property_id;
  const lang = body.lang === "es" ? "es" : "en";
  if (!propertyId) {
    return NextResponse.json({ error: "property_id_required" }, { status: 400 });
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, owner_id, pricing_tier, mls_status")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: "property_not_found_or_not_yours" },
      { status: 404 },
    );
  }
  if (!property.pricing_tier || !TIERS.has(property.pricing_tier)) {
    return NextResponse.json(
      { error: "tier_not_selected" },
      { status: 400 },
    );
  }
  if (property.mls_status !== "draft") {
    return NextResponse.json(
      { error: "property_not_in_draft", status: property.mls_status },
      { status: 409 },
    );
  }

  // Server-side agreement gate — UI also blocks this but never trust the UI.
  const { data: agreement } = await supabase
    .from("agreements")
    .select("status")
    .eq("property_id", propertyId)
    .in("status", ["signed", "completed"])
    .limit(1)
    .maybeSingle();
  if (!agreement) {
    return NextResponse.json(
      { error: "agreement_not_signed" },
      { status: 409 },
    );
  }

  const origin = new URL(req.url).origin;
  const tier = property.pricing_tier as PricingTierId;
  try {
    const { sessionId, url } = await createTierCheckoutSession({
      tier,
      propertyId,
      userId: user.id,
      userEmail: user.email,
      successUrl: `${origin}/${lang}/listing/new?step=8&id=${propertyId}`,
      cancelUrl: `${origin}/${lang}/listing/new?step=8&id=${propertyId}&error=cancelled`,
    });

    const { error: insErr } = await supabase.from("payments").insert({
      property_id: propertyId,
      user_id: user.id,
      vendor: "stripe",
      tier,
      payment_type: "flat_fee",
      stripe_checkout_session_id: sessionId,
      amount: PRICING_TIERS[tier].flatFee,
      currency: "usd",
      status: "pending",
    });
    if (insErr) {
      // Don't swallow this — surface the full Postgres detail so we know
      // which column / constraint rejected the row. Webhook can still
      // reconcile but only if it can find the row by session id.
      console.error("payments insert failed:", JSON.stringify({
        code: insErr.code,
        message: insErr.message,
        details: insErr.details,
        hint: insErr.hint,
      }));
    }

    return NextResponse.json({ url, session_id: sessionId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "stripe_error";
    return NextResponse.json(
      { error: "stripe_session_failed", detail: msg },
      { status: 502 },
    );
  }
}

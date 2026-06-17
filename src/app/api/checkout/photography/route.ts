// POST /api/checkout/photography  — body: { property_id, lang? }
//
// Standalone professional-photography add-on ($495) for sellers whose plan
// doesn't include it (Essentials). Creates a Stripe Checkout Session, persists
// a 'pending' payments row, and returns the redirect URL. The webhook
// (metadata kind=photography) marks it succeeded on payment — it does NOT flip
// the property's mls_status (this is an add-on, not the listing flat fee).
//
// NOTE: payments.payment_type is CHECK-constrained to flat_fee|commission|
// refund, so we record this as 'flat_fee' with tier=null (a flat service fee).
// A dedicated 'photography' type would need a CHECK migration (owner sign-off).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createPhotographyCheckoutSession } from "@/lib/stripe";
import { PHOTOGRAPHY_ADDON_PRICE } from "@/lib/pricing-tiers";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

interface Body {
  property_id?: string;
  lang?: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const limited = await enforceLimit(
    apiLimiter("checkout:photography", 20, "1 h"),
    `u:${user.id}`,
    {
      label: "checkout:photography",
      message: "Too many checkout attempts. Please wait a few minutes and try again.",
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
    .select("id, owner_id")
    .eq("id", propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: "property_not_found_or_not_yours" },
      { status: 404 },
    );
  }

  const origin = new URL(req.url).origin;
  try {
    const { sessionId, url } = await createPhotographyCheckoutSession({
      propertyId,
      userId: user.id,
      userEmail: user.email,
      successUrl: `${origin}/${lang}/listing/new?step=5&id=${propertyId}&photography=1`,
      cancelUrl: `${origin}/${lang}/listing/new?step=5&id=${propertyId}&error=cancelled`,
    });

    const { error: insErr } = await supabase.from("payments").insert({
      property_id: propertyId,
      user_id: user.id,
      vendor: "stripe",
      tier: null,
      payment_type: "flat_fee",
      stripe_checkout_session_id: sessionId,
      amount: PHOTOGRAPHY_ADDON_PRICE,
      currency: "usd",
      status: "pending",
    });
    if (insErr) {
      console.error("photography payments insert failed:", JSON.stringify({
        code: insErr.code,
        message: insErr.message,
        details: insErr.details,
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

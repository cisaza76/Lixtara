// POST /api/checkout/staging-overage — body: { quantity?, property_id?, lang? }
//
// Buys extra AI virtual-staging credits ($5/action) once a listing has used its
// free quota. The Stripe webhook (metadata kind=staging_overage) grants the
// credits to the user's wallet on payment; no row is written here.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createStagingOverageCheckoutSession } from "@/lib/stripe";
import { STAGING_MAX_PURCHASE } from "@/lib/staging";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

interface Body {
  quantity?: number;
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
    apiLimiter("checkout:staging-overage", 20, "1 h"),
    `u:${user.id}`,
    {
      label: "checkout:staging-overage",
      message: "Too many attempts. Please wait a moment and try again.",
    },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const lang = body.lang === "es" ? "es" : "en";
  const propertyId =
    typeof body.property_id === "string" ? body.property_id : null;
  const quantity = Math.max(
    1,
    Math.min(STAGING_MAX_PURCHASE, Math.floor(Number(body.quantity ?? 1)) || 1),
  );

  const origin = new URL(req.url).origin;
  const successUrl = propertyId
    ? `${origin}/${lang}/listing/new?step=5&id=${propertyId}&staging_credits=1`
    : `${origin}/${lang}/dashboard?staging_credits=1`;
  const cancelUrl = propertyId
    ? `${origin}/${lang}/listing/new?step=5&id=${propertyId}&error=cancelled`
    : `${origin}/${lang}/dashboard?error=cancelled`;

  try {
    const { url } = await createStagingOverageCheckoutSession({
      quantity,
      userId: user.id,
      userEmail: user.email,
      successUrl,
      cancelUrl,
    });
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "stripe_error";
    return NextResponse.json(
      { error: "stripe_session_failed", detail: msg },
      { status: 502 },
    );
  }
}

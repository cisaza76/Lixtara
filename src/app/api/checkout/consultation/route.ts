// POST /api/checkout/consultation  — body: { product, lang? }
//
// Creates a Stripe Checkout Session for a consultation product. The hour tokens
// are granted by the Stripe webhook on checkout.session.completed (metadata
// kind=consultation), so no row is written here.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createConsultationCheckoutSession } from "@/lib/stripe";
import { isConsultationProduct } from "@/lib/consultations";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";

interface Body {
  product?: string;
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
    apiLimiter("checkout:consultation", 20, "1 h"),
    `u:${user.id}`,
    { label: "checkout:consultation", message: "Too many attempts — wait a moment." },
  );
  if (limited) return limited;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const product = String(body.product ?? "");
  const lang = body.lang === "es" ? "es" : "en";
  if (!isConsultationProduct(product)) {
    return NextResponse.json({ error: "invalid_product" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  try {
    const { url } = await createConsultationCheckoutSession({
      product,
      userId: user.id,
      userEmail: user.email,
      successUrl: `${origin}/${lang}/consultations?purchased=1`,
      cancelUrl: `${origin}/${lang}/consultations?error=cancelled`,
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

// POST /api/checkout/tier
// Body (JSON): { property_id, lang?, accept_refund_terms: true, refund_terms_version }
//
// Sin la casilla de reembolso aceptada (y en la versión vigente de los Términos) no hay
// checkout: 400 refund_terms_required / refund_terms_outdated. La aceptación se registra en
// terms_acceptances con la sesión de Stripe; si no queda registrada, no se paga (503).
//
// Creates a Stripe Checkout Session for the property's tier flat fee.
// Persists a `payments` row in 'pending' status with the session id. Returns
// the Stripe redirect URL — client navigates there.

import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTierCheckoutSession, expireCheckoutSession } from "@/lib/stripe";
import { checkoutAttribution } from "@/lib/ga4-attribution";
import { PRICING_TIERS, type PricingTierId } from "@/lib/pricing-tiers";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { recordFunnelEvent } from "@/lib/funnel-events.server";
import { createService } from "@/lib/supabase/service";
import { decideCheckout, type ExistingPayment } from "@/lib/checkout-guard";
import { checkoutGuardDeps } from "@/lib/checkout-return.server";
import { CONSENTS } from "@/lib/legal/consents";
import { recordAcceptance } from "@/lib/legal/consents.server";

interface Body {
  property_id?: string;
  lang?: string;
  accept_refund_terms?: unknown;
  refund_terms_version?: unknown;
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
  // Casilla de reembolso del paso 8: obligatoria, y de la versión vigente de los Términos.
  if (body.accept_refund_terms !== true) {
    return NextResponse.json({ error: "refund_terms_required" }, { status: 400 });
  }
  if (body.refund_terms_version !== CONSENTS.terms_refund.version) {
    return NextResponse.json({ error: "refund_terms_outdated" }, { status: 409 });
  }
  const recordRefundAck = (sessionId: string) =>
    recordAcceptance({
      document: "terms_refund",
      lang,
      context: "checkout_tier",
      userId: user.id,
      propertyId,
      // El texto que vio lleva el precio y la comisión de ESTE plan (se resuelve al llamar).
      tier,
      stripeCheckoutSessionId: sessionId,
      headers: req.headers,
    });

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

  // Doble cobro: con una sesión abierta se reutiliza su URL; con una completada no se
  // crea otra ("Estamos confirmando tu pago"). Lectura con la clave de servidor para que
  // ninguna política de RLS esconda un pago previo.
  const { data: prior, error: priorErr } = await createService()
    .from("payments")
    .select("status, stripe_checkout_session_id")
    .eq("property_id", propertyId)
    .eq("payment_type", "flat_fee")
    .not("tier", "is", null) // la fotografía también es flat_fee, con tier null
    .in("status", ["pending", "succeeded"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (priorErr) {
    console.error(JSON.stringify({ event: "checkout_tier_prior_lookup_failed", property_id: propertyId, message: priorErr.message }));
    return NextResponse.json({ error: "payment_check_unavailable" }, { status: 503 });
  }
  const decision = await decideCheckout(
    (prior ?? []) as ExistingPayment[],
    tier,
    checkoutGuardDeps(propertyId, user.id),
  );
  if (decision.action === "confirming") {
    return NextResponse.json({ error: "payment_confirming" }, { status: 409 });
  }
  if (decision.action === "unavailable") {
    return NextResponse.json({ error: "payment_check_unavailable" }, { status: 503 });
  }
  if (decision.action === "reuse") {
    if (!(await recordRefundAck(decision.sessionId))) {
      return NextResponse.json({ error: "consent_record_failed" }, { status: 503 });
    }
    return NextResponse.json({ url: decision.url, session_id: decision.sessionId, reused: true });
  }

  try {
    const { sessionId, url, livemode } = await createTierCheckoutSession({
      attribution: checkoutAttribution(req.headers.get("cookie"), process.env.GA4_MEASUREMENT_ID, lang),
      lang,
      tier,
      propertyId,
      userId: user.id,
      userEmail: user.email,
      successUrl: `${origin}/${lang}/listing/new?step=8&id=${propertyId}`,
      cancelUrl: `${origin}/${lang}/listing/new?step=8&id=${propertyId}&error=cancelled`,
      refundTermsVersion: CONSENTS.terms_refund.version,
    });

    // Sin prueba de la casilla no se paga: la sesión se cierra antes de que alguien la use.
    if (!(await recordRefundAck(sessionId))) {
      await expireCheckoutSession(sessionId).catch(() => {});
      return NextResponse.json({ error: "consent_record_failed" }, { status: 503 });
    }

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

    after(() =>
      recordFunnelEvent({
        event: "checkout_started",
        propertyId,
        userId: user.id,
        step: 8,
        metadata: { lang, plan_tier: tier },
        livemode,
      }),
    );

    return NextResponse.json({ url, session_id: sessionId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "stripe_error";
    // Sin esto el 502 no deja rastro en los logs de Vercel (solo viaja en la respuesta).
    console.error(
      JSON.stringify({
        event: "checkout_tier_session_failed",
        property_id: propertyId,
        tier,
        message: msg,
        type: (e as { type?: string })?.type ?? null,
        code: (e as { code?: string })?.code ?? null,
        request_id: (e as { requestId?: string })?.requestId ?? null,
      }),
    );
    return NextResponse.json(
      { error: "stripe_session_failed", detail: msg },
      { status: 502 },
    );
  }
}

// Cumplimiento de un pago de plan (tier) — ÚNICO lugar que marca un pago `succeeded` y
// pasa el listing a `pending_approval`. Lo llaman el webhook de Stripe y el regreso del
// vendedor desde Checkout (paso 8, `checkout.sessions.retrieve`), así que debe ser
// idempotente POR SESIÓN, no por evento: quien gana la actualización condicionada del
// pago hace los efectos (embudo, correos, GA4); el otro recibe "already" y no repite nada.
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPaymentReceipt, sendBrokerNewPending } from "@/lib/email";
import { lookupRecipientLang } from "@/lib/email-recipient-lang";
import { isPricingTierId } from "@/lib/pricing-tiers";
import { recordServerEvent } from "@/lib/analytics.server";
import { recordFunnelEvent } from "@/lib/funnel-events.server";
import { sendGa4Purchase } from "@/lib/ga4-mp.server";

export type TierFulfillment = "fulfilled" | "already" | "not_paid";

/** Sesión de un plan (no consulta, fotografía ni staging). */
export function isTierSession(session: Pick<Stripe.Checkout.Session, "metadata">): boolean {
  const kind = session.metadata?.kind;
  return !kind && !!session.metadata?.property_id && !!session.metadata?.tier;
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
}

/**
 * Marca el pago y cumple el plan una sola vez por sesión. `requirePaid`: la tarjeta queda
 * `paid` al completar; los métodos diferidos llegan después por
 * `async_payment_succeeded`, que llama con `requirePaid = false` (ya confirmado).
 */
export async function fulfillTierCheckout(
  db: SupabaseClient,
  session: Stripe.Checkout.Session,
  opts: { requirePaid?: boolean } = {},
): Promise<TierFulfillment> {
  if ((opts.requirePaid ?? true) && session.payment_status !== "paid") return "not_paid";

  const sessionId = session.id;
  const propertyId = session.metadata?.property_id ?? null;
  const piId = paymentIntentId(session);
  const now = new Date().toISOString();

  // Actualización condicionada: solo la primera pasa de no-succeeded a succeeded.
  const { data: won, error: payErr } = await db
    .from("payments")
    .update({ status: "succeeded", stripe_payment_intent_id: piId, completed_at: now })
    .eq("stripe_checkout_session_id", sessionId)
    .neq("status", "succeeded")
    .select("id");
  if (payErr) console.error("tier fulfillment: payment update failed", payErr);

  if (!won || won.length === 0) {
    const { data: existing } = await db
      .from("payments")
      .select("status")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    if (existing) return "already";
    // Sin fila (el insert de /api/checkout/tier falló): se crea ya pagada. El índice
    // único por sesión hace que, en una carrera, solo una inserción gane.
    const tier = session.metadata?.tier ?? null;
    const userId = session.metadata?.user_id ?? null;
    if (!propertyId || !tier || !userId) return "already";
    const { error: insErr } = await db.from("payments").insert({
      property_id: propertyId,
      user_id: userId,
      vendor: "stripe",
      tier,
      payment_type: "flat_fee",
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: piId,
      amount: (session.amount_total ?? 0) / 100,
      currency: session.currency ?? "usd",
      status: "succeeded",
      completed_at: now,
    });
    if (insErr) {
      if (insErr.code === "23505") return "already";
      console.error("tier fulfillment: payment insert failed", insErr);
    }
  }

  if (!propertyId) return "fulfilled";

  // El plan se toma de lo que Stripe cobró (metadata), no de la fila: el vendedor puede
  // editar pricing_tier mientras el listing es borrador, es decir, hasta este momento.
  const paidTier = session.metadata?.tier;
  await db
    .from("properties")
    .update(
      paidTier && isPricingTierId(paidTier)
        ? { mls_status: "pending_approval", pricing_tier: paidTier }
        : { mls_status: "pending_approval" },
    )
    .eq("id", propertyId)
    .eq("mls_status", "draft");

  // Evento comercial verificable (embudo vendedor), solo en nuestros logs. Nunca bloquea.
  recordServerEvent({
    event: "seller_plan_purchased",
    props: { tier: paidTier && isPricingTierId(paidTier) ? paidTier : "unknown" },
  });
  // Embudo (listing_funnel_v): pago con monto; livemode=false lo marca como prueba.
  await recordFunnelEvent({
    event: "listing_paid",
    propertyId,
    userId: session.metadata?.user_id ?? null,
    step: 8,
    metadata: {
      amount: (session.amount_total ?? 0) / 100,
      ...(paidTier && isPricingTierId(paidTier) ? { plan_tier: paidTier } : {}),
    },
    livemode: session.livemode,
  });

  await sendPaymentEmails(db, session, propertyId);
  await sendGa4Purchase(session); // nunca lanza; solo con consentimiento + live + Production
  return "fulfilled";
}

// Best-effort: un fallo de correo nunca bloquea el cumplimiento.
async function sendPaymentEmails(db: SupabaseClient, session: Stripe.Checkout.Session, propertyId: string) {
  try {
    const { data: prop } = await db
      .from("properties")
      .select("address_street,address_city,address_state,address_zip,list_price,pricing_tier,owner_id")
      .eq("id", propertyId)
      .maybeSingle();
    if (!prop) return;
    const address = `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`;
    const tier = (prop.pricing_tier ?? session.metadata?.tier ?? "pro") as string;
    const amount = (session.amount_total ?? 0) / 100;
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lixtara.vercel.app";
    const { data: sellerAuth } = await db.auth.admin.getUserById(prop.owner_id);
    const sellerEmail = sellerAuth.user?.email;
    const { data: sellerProfile } = await db
      .from("users")
      .select("first_name,last_name")
      .eq("id", prop.owner_id)
      .maybeSingle();
    const sellerName =
      [sellerProfile?.first_name, sellerProfile?.last_name].filter(Boolean).join(" ").trim() ||
      sellerEmail ||
      "Seller";
    if (sellerEmail) {
      // Idioma del vendedor si lo conocemos (seller_leads.locale); si no, inglés.
      const sellerLang = (await lookupRecipientLang(prop.owner_id)) ?? "en";
      await sendPaymentReceipt({
        to: sellerEmail,
        lang: sellerLang,
        amount,
        tier,
        propertyAddress: address,
        dashboardUrl: `${origin}/${sellerLang}/dashboard`,
      });
    }
    // Notify the broker queue (Camilo while in test mode).
    await sendBrokerNewPending({
      to: process.env.BROKER_NOTIFICATION_EMAIL ?? "camilo.isaza@gmail.com",
      sellerName,
      propertyAddress: address,
      tier,
      listPrice: prop.list_price ?? 0,
      adminUrl: `${origin}/en/admin`,
    });
  } catch (e) {
    console.error("tier fulfillment: email side-effects failed:", e);
  }
}

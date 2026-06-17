// POST /api/webhooks/stripe
// Stripe POSTs payment lifecycle events here. We trust this endpoint as the
// canonical signal — never flip a payment to 'succeeded' from any other code
// path. On a PAID checkout we mark the payment row succeeded and flip the
// property's mls_status from 'draft' to 'pending_approval'.
//
// NOTE: this route bypasses Next's body parsing because we need the RAW body
// bytes to verify Stripe's signature. We use req.text() which preserves the
// raw payload exactly as sent.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/stripe";
import { sendPaymentReceipt, sendBrokerNewPending } from "@/lib/email";
import { claimWebhookEvent } from "@/lib/webhook-dedup";
import { grantStagingCredits } from "@/lib/staging-credits";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

type ServiceClient = ReturnType<typeof serviceClient>;

// Fulfill a PAID checkout: grant consultation hour tokens, or mark the tier
// payment succeeded + flip the property to pending_approval + send receipts.
// Called both for card payments (paid at completion) AND for delayed methods
// once they actually clear (checkout.session.async_payment_succeeded). Event
// idempotency is handled by the caller (claimWebhookEvent), so this runs at
// most once per Stripe event.
async function fulfillCheckout(
  supabase: ServiceClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // Consultation purchase → grant prepaid hour tokens (90-day validity is the
  // column default).
  if (session.metadata?.kind === "consultation") {
    const buyerId = session.metadata?.user_id ?? null;
    const realtorHours = Number(session.metadata?.realtor_hours ?? 0);
    const attorneyHours = Number(session.metadata?.attorney_hours ?? 0);
    if (buyerId) {
      const rows: Array<{
        user_id: string;
        service_type: string;
        hours_total: number;
      }> = [];
      if (realtorHours > 0)
        rows.push({ user_id: buyerId, service_type: "realtor", hours_total: realtorHours });
      if (attorneyHours > 0)
        rows.push({ user_id: buyerId, service_type: "attorney", hours_total: attorneyHours });
      if (rows.length > 0) {
        const { error } = await supabase.from("consultation_tokens").insert(rows);
        if (error) console.error("consultation token grant failed", error.message);
      }
    }
    return;
  }

  // Professional-photography add-on → mark the payment paid. It's an add-on,
  // NOT the listing flat fee, so we do NOT flip the property's mls_status.
  if (session.metadata?.kind === "photography") {
    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const { error } = await supabase
      .from("payments")
      .update({
        status: "succeeded",
        stripe_payment_intent_id: piId,
        completed_at: new Date().toISOString(),
      })
      .eq("stripe_checkout_session_id", session.id);
    if (error) console.error("photography payment update failed", error.message);
    return;
  }

  // AI staging overage → grant the purchased credits to the user's wallet.
  if (session.metadata?.kind === "staging_overage") {
    const userId = session.metadata?.user_id ?? null;
    const credits = Number(session.metadata?.credits ?? 0);
    if (userId && credits > 0) {
      await grantStagingCredits(supabase, userId, credits);
    }
    return;
  }

  const sessionId = session.id;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const propertyId = session.metadata?.property_id ?? null;

  const { data: updatedRows, error: payErr } = await supabase
    .from("payments")
    .update({
      status: "succeeded",
      stripe_payment_intent_id: paymentIntentId,
      completed_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", sessionId)
    .select("id, property_id");
  if (payErr) {
    console.error("stripe webhook: payment update failed", payErr);
  }

  // If the payment row didn't exist yet (e.g. our insert failed earlier but
  // Stripe still completed) create it now from session metadata.
  if ((!updatedRows || updatedRows.length === 0) && propertyId) {
    const tier = session.metadata?.tier ?? null;
    const userId = session.metadata?.user_id ?? null;
    if (tier && userId) {
      await supabase.from("payments").insert({
        property_id: propertyId,
        user_id: userId,
        vendor: "stripe",
        tier,
        payment_type: "flat_fee",
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId,
        amount: (session.amount_total ?? 0) / 100,
        currency: session.currency ?? "usd",
        status: "succeeded",
        completed_at: new Date().toISOString(),
      });
    }
  }

  // Flip the property to pending_approval so the broker queue picks it up.
  if (propertyId) {
    await supabase
      .from("properties")
      .update({ mls_status: "pending_approval" })
      .eq("id", propertyId)
      .eq("mls_status", "draft");

    // Best-effort emails — never block the webhook on email failure.
    try {
      const { data: prop } = await supabase
        .from("properties")
        .select(
          "address_street,address_city,address_state,address_zip,list_price,pricing_tier,owner_id",
        )
        .eq("id", propertyId)
        .maybeSingle();
      if (prop) {
        const address = `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`;
        const tier = (prop.pricing_tier ?? session.metadata?.tier ?? "pro") as string;
        const amount = (session.amount_total ?? 0) / 100;
        const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lixtara.vercel.app";
        const { data: sellerAuth } = await supabase.auth.admin.getUserById(
          prop.owner_id,
        );
        const sellerEmail = sellerAuth.user?.email;
        const { data: sellerProfile } = await supabase
          .from("users")
          .select("first_name,last_name")
          .eq("id", prop.owner_id)
          .maybeSingle();
        const sellerName =
          [sellerProfile?.first_name, sellerProfile?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || sellerEmail || "Seller";

        if (sellerEmail) {
          await sendPaymentReceipt({
            to: sellerEmail,
            amount,
            tier,
            propertyAddress: address,
            dashboardUrl: `${origin}/en/dashboard`,
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
      }
    } catch (e) {
      console.error("stripe webhook email side-effects failed:", e);
    }
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event;
  try {
    event = verifyWebhookSignature(rawBody, sig);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe webhook signature failed:", msg, {
      hasSig: !!sig,
      bodyLen: rawBody.length,
      secretFirst6: (process.env.STRIPE_WEBHOOK_SECRET ?? "").slice(0, 6),
    });
    return NextResponse.json({ error: "bad_signature", detail: msg }, { status: 401 });
  }

  const supabase = serviceClient();

  // Idempotency: claim the event before doing anything with side effects.
  // Stripe redelivers events (retries, at-least-once), and without this a
  // duplicate would re-send receipt/broker emails and re-run the side effects.
  // "unavailable" (e.g. the migration isn't applied yet) falls through and
  // processes anyway — see claimWebhookEvent.
  const claim = await claimWebhookEvent(
    supabase,
    "stripe",
    event.id,
    event.type,
  );
  if (claim === "duplicate") {
    return NextResponse.json({ received: true, deduped: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // Card payments are 'paid' the moment the session completes. Delayed
      // methods (ACH/bank debits) arrive here as 'processing'/'unpaid' and
      // confirm later via async_payment_succeeded — do NOT mark succeeded or
      // list the property until the money is actually captured.
      if (session.payment_status !== "paid") break;
      await fulfillCheckout(supabase, session);
      break;
    }

    case "checkout.session.async_payment_succeeded": {
      // A delayed payment method cleared — fulfill now.
      await fulfillCheckout(supabase, event.data.object);
      break;
    }

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      await supabase
        .from("payments")
        .update({ status: "failed", error_message: event.type })
        .eq("stripe_checkout_session_id", session.id);
      break;
    }

    default:
      // Unhandled event — ack so Stripe doesn't retry.
      break;
  }

  return NextResponse.json({ received: true });
}

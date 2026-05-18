// POST /api/webhooks/stripe
// Stripe POSTs payment lifecycle events here. We trust this endpoint as the
// canonical signal — never flip a payment to 'succeeded' from any other code
// path. On checkout.session.completed we mark the payment row succeeded and
// flip the property's mls_status from 'draft' to 'pending_approval'.
//
// NOTE: this route bypasses Next's body parsing because we need the RAW body
// bytes to verify Stripe's signature. We use req.text() which preserves the
// raw payload exactly as sent.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/stripe";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const sessionId = session.id;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      const propertyId = session.metadata?.property_id ?? null;

      const updateFields: Record<string, unknown> = {
        status: "succeeded",
        stripe_payment_intent_id: paymentIntentId,
        completed_at: new Date().toISOString(),
      };

      const { data: updatedRows, error: payErr } = await supabase
        .from("payments")
        .update(updateFields)
        .eq("stripe_checkout_session_id", sessionId)
        .select("id, property_id");
      if (payErr) {
        console.error("stripe webhook: payment update failed", payErr);
      }

      // If the payment row didn't exist yet (e.g. our insert failed earlier
      // but Stripe still completed) create it now from session metadata.
      if ((!updatedRows || updatedRows.length === 0) && propertyId) {
        const tier = session.metadata?.tier ?? null;
        const userId = session.metadata?.user_id ?? null;
        if (tier && userId) {
          await supabase.from("payments").insert({
            property_id: propertyId,
            user_id: userId,
            vendor: "stripe",
            tier,
            payment_type: "tier",
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
      }
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

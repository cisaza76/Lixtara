// Envía `purchase` a GA4 por Measurement Protocol desde el webhook de Stripe. Reglas en
// ga4-attribution.ts. Nunca lanza ni demora el webhook más de 3 s: un fallo de GA4 solo
// queda en el log, y Stripe recibe su 200 igual.
//
// Variables (server-only, solo Production): GA4_MEASUREMENT_ID (G-…, no es secreto) y
// GA4_MP_API_SECRET (lo crea el owner). Sin las dos, no se envía nada.

import type Stripe from "stripe";
import { createService } from "@/lib/supabase/service";
import { purchaseItem, purchasePayload, shouldSendPurchase } from "@/lib/ga4-attribution";

export async function sendGa4Purchase(session: Stripe.Checkout.Session): Promise<void> {
  try {
    const measurementId = process.env.GA4_MEASUREMENT_ID;
    const apiSecret = process.env.GA4_MP_API_SECRET;
    const md = (session.metadata ?? {}) as Record<string, string>;
    const item = purchaseItem(md);
    if (!item) return;

    // Una propiedad de prueba nunca cuenta como ingreso (ni la compra real reembolsada
    // que valida el webhook: ese listing se marca is_test antes de pagar). Sin propiedad
    // (consultas, staging sin listing) no hay nada que marcar.
    let propertyIsTest: boolean | null = false;
    if (md.property_id) {
      const { data } = await createService()
        .from("properties")
        .select("is_test")
        .eq("id", md.property_id)
        .maybeSingle();
      propertyIsTest = data ? Boolean((data as { is_test: boolean | null }).is_test) : null;
    }

    if (
      !shouldSendPurchase({
        vercelEnv: process.env.VERCEL_ENV,
        livemode: session.livemode,
        consent: md.consent,
        clientId: md.ga_client_id,
        propertyIsTest,
        hasConfig: Boolean(measurementId && apiSecret),
      })
    ) {
      return;
    }

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      measurementId!,
    )}&api_secret=${encodeURIComponent(apiSecret!)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        purchasePayload({
          clientId: md.ga_client_id,
          sessionId: md.ga_session_id,
          transactionId: session.id,
          value: (session.amount_total ?? 0) / 100,
          currency: session.currency ?? "usd",
          item,
        }),
      ),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error("ga4 purchase: HTTP", res.status);
  } catch (e) {
    console.error("ga4 purchase failed", e instanceof Error ? e.message : e);
  }
}

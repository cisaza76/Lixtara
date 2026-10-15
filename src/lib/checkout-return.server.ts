// Paso 8 sin depender solo del webhook: al volver de Stripe (o al reintentar el pago) se
// lee la sesión en Stripe y, si está pagada, se cumple con el mismo código que el
// webhook (fulfillTierCheckout, idempotente por sesión).
import { createService } from "@/lib/supabase/service";
import { expireCheckoutSession, getCheckoutSession } from "@/lib/stripe";
import { fulfillTierCheckout, isTierSession, type TierFulfillment } from "@/lib/tier-fulfillment.server";
import type { CheckoutSessionView, GuardDeps } from "@/lib/checkout-guard";

export type ReconcileResult = TierFulfillment | "mismatch" | "error";

/**
 * Cumple la sesión si Stripe dice `paid` y es del plan de ESTE listing y ESTE usuario
 * (metadata puesta por nuestro servidor al crearla), nunca de otro.
 */
export async function reconcileTierCheckout(input: {
  sessionId: string;
  propertyId: string;
  userId: string;
}): Promise<ReconcileResult> {
  try {
    const session = await getCheckoutSession(input.sessionId);
    if (
      !isTierSession(session) ||
      session.metadata?.property_id !== input.propertyId ||
      session.metadata?.user_id !== input.userId
    ) {
      return "mismatch";
    }
    return await fulfillTierCheckout(createService(), session);
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "checkout_reconcile_failed",
        property_id: input.propertyId,
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return "error";
  }
}

/** Dependencias reales de decideCheckout para un listing y su dueño. */
export function checkoutGuardDeps(propertyId: string, userId: string): GuardDeps {
  return {
    retrieve: async (id): Promise<CheckoutSessionView> => {
      const s = await getCheckoutSession(id);
      if (s.metadata?.property_id !== propertyId) throw new Error("session_property_mismatch");
      return {
        id: s.id,
        status: s.status,
        payment_status: s.payment_status,
        url: s.url,
        tier: s.metadata?.tier ?? null,
      };
    },
    expire: expireCheckoutSession,
    markFailed: async (id, reason) => {
      const { error } = await createService()
        .from("payments")
        .update({ status: "failed", error_message: reason })
        .eq("stripe_checkout_session_id", id)
        .eq("status", "pending");
      if (error) console.error("checkout guard: mark failed", error.message);
    },
    fulfillPaid: async (id) => {
      await reconcileTierCheckout({ sessionId: id, propertyId, userId });
    },
  };
}

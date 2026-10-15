// Escribe los hitos del embudo del vendedor en funnel_events (100 % de los registros, con
// o sin consentimiento de cookies: es un registro operativo propio, sin datos personales).
// listing_funnel_v los resume por listing para el tablero.
//
// Nunca lanza: un fallo aquí no puede romper el paso, la firma ni el webhook de Stripe.

import { createService } from "@/lib/supabase/service";
import { funnelIsTest, sanitizeFunnelMetadata, type FunnelEventName } from "@/lib/funnel-events";

export async function recordFunnelEvent(input: {
  event: FunnelEventName;
  propertyId: string;
  userId?: string | null;
  step?: number | null;
  metadata?: Record<string, unknown>;
  /** Stripe event/session livemode; solo en eventos de pago. */
  livemode?: boolean;
}): Promise<void> {
  try {
    const svc = createService();
    const { data: prop } = await svc
      .from("properties")
      .select("is_test")
      .eq("id", input.propertyId)
      .maybeSingle();
    const is_test = funnelIsTest({
      vercelEnv: process.env.VERCEL_ENV,
      propertyIsTest: prop ? Boolean((prop as { is_test: boolean | null }).is_test) : null,
      livemode: input.livemode,
    });
    const { error } = await svc.from("funnel_events").insert({
      event: input.event,
      property_id: input.propertyId,
      user_id: input.userId ?? null,
      step: input.step ?? null,
      metadata: sanitizeFunnelMetadata(input.metadata ?? {}),
      is_test,
    });
    if (error) console.error("funnel event insert failed", input.event, error.code, error.message);
  } catch (e) {
    console.error("funnel event failed", input.event, e instanceof Error ? e.message : e);
  }
}

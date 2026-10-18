// Escribe los hitos del embudo del vendedor en funnel_events (100 % de los registros, con
// o sin consentimiento de cookies: es un registro operativo propio, sin datos personales).
// listing_funnel_v los resume por listing para el tablero.
//
// Nunca lanza: un fallo aquí no puede romper el paso, la firma ni el webhook de Stripe.

import { createService } from "@/lib/supabase/service";
import {
  funnelIsTest,
  sanitizeFunnelMetadata,
  type FunnelEventName,
  type PageViewEventName,
} from "@/lib/funnel-events";

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
      .select("is_test, owner_id")
      .eq("id", input.propertyId)
      .maybeSingle();
    const metadata = { ...(input.metadata ?? {}) };
    // Eventos sin request del vendedor (webhook de DocuSign o Stripe, revisión del admin):
    // 1) el idioma del último evento de este listing que lo tenga (la página del paso);
    // 2) si no hay, el del gate del paso 1 (seller_leads.locale).
    if (metadata.lang === undefined) {
      const { data: last } = await svc
        .from("funnel_events")
        .select("metadata")
        .eq("property_id", input.propertyId)
        .not("metadata->>lang", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastLang = (last as { metadata?: { lang?: unknown } } | null)?.metadata?.lang;
      if (lastLang === "es" || lastLang === "en") metadata.lang = lastLang;
    }
    const ownerId = (prop as { owner_id?: string | null } | null)?.owner_id ?? null;
    if (metadata.lang === undefined && ownerId) {
      const { data: lead } = await svc
        .from("seller_leads")
        .select("locale")
        .eq("user_id", ownerId)
        .maybeSingle();
      const locale = (lead as { locale?: string } | null)?.locale;
      if (locale === "es" || locale === "en") metadata.lang = locale;
    }
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
      metadata: sanitizeFunnelMetadata(metadata),
      is_test,
    });
    if (error) console.error("funnel event insert failed", input.event, error.code, error.message);
  } catch (e) {
    console.error("funnel event failed", input.event, e instanceof Error ? e.message : e);
  }
}

/**
 * Visita a una página de campaña (hoy, /owners): solo el evento y el idioma. Sin usuario,
 * sesión, listing ni UTM, así que no depende del consentimiento. Nunca lanza.
 */
export async function recordPageViewEvent(event: PageViewEventName, lang: string): Promise<void> {
  try {
    const { error } = await createService()
      .from("funnel_events")
      .insert({
        event,
        metadata: sanitizeFunnelMetadata({ lang }),
        is_test: process.env.VERCEL_ENV !== "production",
      });
    if (error) console.error("page view event insert failed", event, error.code, error.message);
  } catch (e) {
    console.error("page view event failed", event, e instanceof Error ? e.message : e);
  }
}

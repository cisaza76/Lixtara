// Eventos COMERCIALES desde el servidor, a partir de cambios de estado verificables (no de
// clics del navegador): lead creado, cambio de estado del lead, acuerdo registrado, plan
// pagado, listing publicado. Van solo a PostHog (producto), por su API HTTP.
//
// Identidad: un id interno (`lead:<uuid>`, `property:<uuid>`), nunca un email, nombre o
// teléfono. Propiedades: solo valores de listas cerradas (estado, tipo, plan).
//
// Fire-and-forget: nunca lanza y nunca demora más de 2 s la acción que lo dispara. Sin
// NEXT_PUBLIC_POSTHOG_KEY no hace nada.
import { analyticsConfig } from "@/lib/analytics-config";

export type ServerEvent =
  | { event: "buyer_lead_created"; distinctId: `lead:${string}`; props: { source: string; target: "own" | "mls"; exclusive: boolean } }
  | { event: "buyer_lead_status_changed"; distinctId: `lead:${string}`; props: { from: string; to: string } }
  | { event: "buyer_agreement_recorded"; distinctId: `lead:${string}`; props: { type: string } }
  | { event: "seller_plan_purchased"; distinctId: `property:${string}`; props: { tier: string } }
  | { event: "listing_published"; distinctId: `property:${string}`; props: Record<string, never> };

export async function captureServerEvent(
  e: ServerEvent,
  deps: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const cfg = analyticsConfig(env);
  if (!cfg.posthogKey) return;
  try {
    await (deps.fetchImpl ?? fetch)(`${cfg.posthogHost}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: cfg.posthogKey,
        event: e.event,
        distinct_id: e.distinctId,
        properties: { ...e.props, $lib: "lixtara-server", environment: env.VERCEL_ENV ?? "development" },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: "analytics_server_capture_failed",
      name: e.event,
      message: err instanceof Error ? err.message : String(err),
    }));
  }
}

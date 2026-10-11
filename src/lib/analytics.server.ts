// Eventos COMERCIALES desde el servidor, a partir de cambios de estado verificables (no de
// clics del navegador): lead creado, cambio de estado del lead, acuerdo registrado, plan
// pagado, listing publicado.
//
// SE QUEDAN EN NUESTRA INFRAESTRUCTURA (decisión del owner, 2026-10-11): no se envían a
// PostHog ni a GA4. Un evento de servidor no sabe si la persona aceptó la analítica (el
// webhook de Stripe o una acción de la broker no traen su cookie), así que no sale.
// Se escribe una línea JSON en los logs de Vercel, sin identificadores (ni de lead ni de
// propiedad) y solo con valores de listas cerradas. Los embudos con detalle por lead salen
// de la base de datos (buyer_leads y su historial), que ya es nuestra.
//
// Nunca lanza: no puede romper la acción que lo dispara.

export type ServerEvent =
  | { event: "buyer_lead_created"; props: { source: string; target: "own" | "mls"; exclusive: boolean } }
  | { event: "buyer_lead_status_changed"; props: { from: string; to: string } }
  | { event: "buyer_agreement_recorded"; props: { type: string } }
  | { event: "seller_plan_purchased"; props: { tier: string } }
  | { event: "listing_published"; props: Record<string, never> };

// Barrera final: solo códigos de lista cerrada (minúsculas, dígitos, guion bajo) y
// booleanos. Cualquier otra cosa (un texto libre colado por error) se registra "invalid".
function safeProps(props: Record<string, unknown>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = typeof v === "boolean" ? v : typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v) ? v : "invalid";
  }
  return out;
}

export function recordServerEvent(
  e: ServerEvent,
  deps: { log?: (line: string) => void; env?: Record<string, string | undefined> } = {},
): void {
  try {
    const env = deps.env ?? process.env;
    (deps.log ?? console.info)(
      JSON.stringify({
        event: "lx_server_event",
        name: e.event,
        props: safeProps(e.props),
        environment: env.VERCEL_ENV ?? "development",
        at: new Date().toISOString(),
      }),
    );
  } catch {
    /* un log que falla no puede romper la acción */
  }
}

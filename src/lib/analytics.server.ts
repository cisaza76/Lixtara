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
        props: e.props,
        environment: env.VERCEL_ENV ?? "development",
        at: new Date().toISOString(),
      }),
    );
  } catch {
    /* un log que falla no puede romper la acción */
  }
}

// Antes de crear una sesión de Checkout para el plan: ¿ya hay una abierta o pagada?
// Una sesión de Stripe se cobra a lo sumo una vez; dos sesiones pueden cobrarse las dos.
// Por eso nunca se crea otra mientras exista una abierta (se reutiliza su URL) o una
// completada (el pago se está confirmando). Lógica pura con dependencias inyectadas.

export type CheckoutSessionView = {
  id: string;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  url: string | null;
  tier: string | null;
};

export type ExistingPayment = { status: string; stripe_checkout_session_id: string | null };

export type GuardDecision =
  | { action: "create" }
  | { action: "reuse"; url: string; sessionId: string }
  | { action: "confirming" }
  | { action: "unavailable" };

export interface GuardDeps {
  retrieve: (sessionId: string) => Promise<CheckoutSessionView>;
  expire: (sessionId: string) => Promise<void>;
  markFailed: (sessionId: string, reason: string) => Promise<void>;
  /** Cumple una sesión ya pagada (el webhook pudo no haber llegado). */
  fulfillPaid: (sessionId: string) => Promise<void>;
}

/**
 * `payments`: filas de plan de este listing, más reciente primero. `tier`: el plan que el
 * vendedor quiere pagar ahora. Si Stripe no responde, `unavailable`: sin poder ver la
 * sesión anterior no se crea otra (fail-closed contra el doble cobro).
 */
export async function decideCheckout(
  payments: ExistingPayment[],
  tier: string,
  deps: GuardDeps,
): Promise<GuardDecision> {
  if (payments.some((p) => p.status === "succeeded")) return { action: "confirming" };

  for (const p of payments) {
    if (p.status !== "pending" || !p.stripe_checkout_session_id) continue;
    const id = p.stripe_checkout_session_id;
    let s: CheckoutSessionView;
    try {
      s = await deps.retrieve(id);
    } catch {
      return { action: "unavailable" };
    }
    if (s.status === "complete") {
      if (s.payment_status === "paid") await deps.fulfillPaid(id);
      // Pagada, o con un método diferido aún en proceso: en ambos casos ya no se cobra otra vez.
      return { action: "confirming" };
    }
    if (s.status === "open") {
      if (s.tier === tier && s.url) return { action: "reuse", url: s.url, sessionId: id };
      // Otro plan: se cierra la sesión vieja antes de abrir la nueva (una sola cobrable).
      try {
        await deps.expire(id);
      } catch {
        return { action: "unavailable" };
      }
      await deps.markFailed(id, "superseded");
      continue;
    }
    // expired (o desconocida): no se puede cobrar; se marca y se sigue.
    await deps.markFailed(id, "checkout.session.expired");
  }
  return { action: "create" };
}

/** Un id de sesión de Checkout bien formado (lo que llega en ?session_id=). */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(value);
}

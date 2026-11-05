// Monto de una sesión de Checkout en USD para la analítica (GA4 purchase, Meta Purchase).
//
// Con Adaptive Pricing, Stripe cobra en la moneda del comprador: `currency` y `amount_total`
// vienen en esa moneda (p. ej. COP) y `currency_conversion` guarda el total y la moneda de
// origen (la de nuestros precios, USD). El valor de los eventos va SIEMPRE en USD:
//   - con currency_conversion: su amount_total, si su source_currency es USD;
//   - sin ella: amount_total, si la sesión es en USD;
//   - cualquier otro caso: null (no se envía un valor en otra moneda).
//
// PURO: sin I/O.

export type CheckoutAmountSource = {
  amount_total: number | null;
  currency: string | null;
  currency_conversion?: { amount_total: number; source_currency: string } | null;
};

/** Total en USD (495, no 49500), o null si no se puede saber en USD. */
export function checkoutUsdValue(session: CheckoutAmountSource): number | null {
  const conv = session.currency_conversion;
  if (conv) {
    return conv.source_currency?.toLowerCase() === "usd" && Number.isFinite(conv.amount_total) ? conv.amount_total / 100 : null;
  }
  if ((session.currency ?? "").toLowerCase() !== "usd" || session.amount_total == null) return null;
  return session.amount_total / 100;
}

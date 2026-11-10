// Métricas del panel de admin (ingresos, aprobaciones pendientes, negocios activos, actividad)
// sin datos de prueba. Producción comparte la base con Preview y con las pruebas de los
// equipos, así que un pago de Stripe en modo de prueba o un listing is_test no cuenta.
//
// `payments` no guarda el livemode de Stripe: el id de la sesión de Checkout lo dice
// (cs_test_… = modo de prueba, cs_live_… = real). Un pago de un listing is_test tampoco cuenta.
//
// PURO: sin I/O. Las consultas embeben `properties(is_test)` (FK property_id).

type EmbeddedProperty = { is_test: boolean | null } | Array<{ is_test: boolean | null }> | null | undefined;

function propertyIsTest(p: EmbeddedProperty): boolean {
  const row = Array.isArray(p) ? p[0] : p;
  return row?.is_test === true;
}

/** Sesión de Checkout creada en modo de prueba de Stripe (livemode = false). */
export function isStripeTestSession(sessionId: string | null | undefined): boolean {
  return typeof sessionId === "string" && sessionId.startsWith("cs_test_");
}

export type MetricPayment = {
  amount: number | string | null;
  stripe_checkout_session_id?: string | null;
  properties?: EmbeddedProperty;
};

/** ¿Es de prueba? Stripe en modo de prueba o un listing is_test. */
export function isTestPayment(p: MetricPayment): boolean {
  return isStripeTestSession(p.stripe_checkout_session_id) || propertyIsTest(p.properties);
}

/** Suma de los pagos reales (sin pagos de prueba). */
export function liveRevenue(rows: MetricPayment[] | null | undefined): number {
  return (rows ?? []).reduce((sum, p) => (isTestPayment(p) ? sum : sum + Number(p.amount ?? 0)), 0);
}

/** Actividad sin la de listings is_test, hasta `limit` filas (en el orden recibido). */
export function liveActivity<T extends { properties?: EmbeddedProperty }>(rows: T[] | null | undefined, limit: number): T[] {
  return (rows ?? []).filter((r) => !propertyIsTest(r.properties)).slice(0, limit);
}

/** Columnas de `payments` que necesitan liveRevenue. */
export const METRIC_PAYMENT_COLUMNS = "amount,stripe_checkout_session_id,properties(is_test)";

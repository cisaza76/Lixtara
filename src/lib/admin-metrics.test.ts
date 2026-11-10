import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isStripeTestSession, isTestPayment, liveActivity, liveRevenue, pendingQueueCount } from "@/lib/admin-metrics";

const live = { is_test: false };
const test = { is_test: true };

describe("métricas del admin sin datos de prueba", () => {
  it("sesión de Checkout en modo de prueba de Stripe (livemode=false)", () => {
    expect(isStripeTestSession("cs_test_a1B2")).toBe(true);
    expect(isStripeTestSession("cs_live_a1B2")).toBe(false);
    expect(isStripeTestSession(null)).toBe(false);
  });

  it("pago de prueba: Stripe en modo de prueba o listing is_test (objeto o arreglo embebido)", () => {
    expect(isTestPayment({ amount: 495, stripe_checkout_session_id: "cs_test_x", properties: live })).toBe(true);
    expect(isTestPayment({ amount: 495, stripe_checkout_session_id: "cs_live_x", properties: test })).toBe(true);
    expect(isTestPayment({ amount: 495, stripe_checkout_session_id: "cs_live_x", properties: [test] })).toBe(true);
    expect(isTestPayment({ amount: 495, stripe_checkout_session_id: "cs_live_x", properties: live })).toBe(false);
    expect(isTestPayment({ amount: 495, stripe_checkout_session_id: null, properties: null })).toBe(false);
  });

  it("ingresos: el pago de prueba de $495 no cuenta; los reales sí", () => {
    expect(liveRevenue([{ amount: 495, stripe_checkout_session_id: "cs_test_x", properties: test }])).toBe(0);
    expect(
      liveRevenue([
        { amount: 495, stripe_checkout_session_id: "cs_test_x", properties: test },
        { amount: "199.00", stripe_checkout_session_id: "cs_live_y", properties: live },
        { amount: 995, stripe_checkout_session_id: "cs_live_z", properties: test },
      ]),
    ).toBe(199);
    expect(liveRevenue(null)).toBe(0);
  });

  it("actividad: sin la de listings is_test, hasta el límite y en orden", () => {
    const rows = [
      { id: 1, properties: test },
      { id: 2, properties: live },
      { id: 3, properties: null },
      { id: 4, properties: [test] },
      { id: 5, properties: live },
    ];
    expect(liveActivity(rows, 10).map((r) => r.id)).toEqual([2, 3, 5]);
    expect(liveActivity(rows, 2).map((r) => r.id)).toEqual([2, 3]);
  });

  it("el home del admin usa estas reglas en sus cuatro métricas", () => {
    const page = readFileSync("src/app/[lang]/admin/page.tsx", "utf8");
    expect(page).toMatch(/\.eq\("mls_status", "pending_approval"\)\n\s+\.eq\("is_test", false\),/);
    expect(page).toMatch(/\.from\("transactions"\)\n\s+\.select\("id,properties!inner\(is_test\)", \{ count: "exact", head: true \}\)\n\s+\.not\("status", "in", "\(closed,cancelled\)"\)\n\s+\.eq\("properties\.is_test", false\),/);
    expect(page).toContain(".select(METRIC_PAYMENT_COLUMNS)");
    expect(page).toContain("const monthRevenue = liveRevenue(monthPayments);");
    expect(page).toContain('.select("description,action_type,created_at,properties(is_test)")');
    expect(page).toMatch(/const activity = liveActivity\(/);
  });

  it("la analítica del admin también", () => {
    const page = readFileSync("src/app/[lang]/admin/analytics/page.tsx", "utf8");
    expect(page).toContain('supabase.from("payments").select(METRIC_PAYMENT_COLUMNS).eq("status", "succeeded")');
    expect(page).toContain("const totalRevenue = liveRevenue(paidPayments.data);");
    expect(page).toContain('supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_test", false)');
    expect(page).toContain('headCount("properties", "mls_status", "active").eq("is_test", false)');
    expect(page).toMatch(/\.eq\("status", "closed"\)\n\s+\.eq\("properties\.is_test", false\),/);
  });
});

describe("admin: pagos y cola de prueba a la vista ", () => {
  const label = (n: number) => `${n} de prueba`;

  it("cabecera de la cola: todos is_test → 'N de prueba'; alguno real → N; vacía → null", () => {
    expect(pendingQueueCount([test, test, test], label)).toBe("3 de prueba");
    expect(pendingQueueCount([test, live], label)).toBe("2");
    expect(pendingQueueCount([live], label)).toBe("1");
    expect(pendingQueueCount([], label)).toBeNull();
    expect(pendingQueueCount(null, label)).toBeNull();
  });

  it("la página marca las filas de 'Pagos recientes' con la regla de las métricas y usa el conteo", () => {
    const src = readFileSync("src/app/[lang]/admin/page.tsx", "utf8");
    expect(src).toMatch(/\.from\("payments"\)\s*\.select\(\s*"[^"]*stripe_checkout_session_id,properties\(is_test\)"/);
    expect(src).toMatch(/isTestPayment\(p\) && \(\s*<span data-test-payment[^>]*>\s*\{rc\.testBadge\}/);
    expect(src).toContain("pendingQueueCount(pending,");
    expect(src).not.toContain("({pending.length})");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendPaymentReceipt = vi.fn(async () => {});
const sendBrokerNewPending = vi.fn(async () => {});
const recordFunnelEvent = vi.fn(async () => {});
const sendGa4Purchase = vi.fn(async () => {});
vi.mock("@/lib/email", () => ({ sendPaymentReceipt, sendBrokerNewPending }));
vi.mock("@/lib/email-recipient-lang", () => ({ lookupRecipientLang: async () => "es" }));
vi.mock("@/lib/analytics.server", () => ({ recordServerEvent: () => {} }));
vi.mock("@/lib/funnel-events.server", () => ({ recordFunnelEvent }));
vi.mock("@/lib/ga4-mp.server", () => ({ sendGa4Purchase }));

const { fulfillTierCheckout, isTierSession } = await import("@/lib/tier-fulfillment.server");

type Op = { table: string; op: string; payload?: unknown };

/** payments: estado actual de la fila de la sesión (null = no existe). */
function fakeDb(state: { payment: string | null; insertError?: { code: string } }) {
  const ops: Op[] = [];
  const db = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "s@x.co" } } }) } },
    from(table: string) {
      const op: Op = { table, op: "select" };
      const filters: Array<[string, string, unknown]> = [];
      const b: Record<string, unknown> = {};
      const run = () => {
        ops.push(op);
        if (table === "payments" && op.op === "update") {
          const neqSucceeded = filters.some(([k, f, v]) => k === "neq" && f === "status" && v === "succeeded");
          const matches = state.payment !== null && !(neqSucceeded && state.payment === "succeeded");
          if (matches) state.payment = "succeeded";
          return { data: matches ? [{ id: "pay1" }] : [], error: null };
        }
        if (table === "payments" && op.op === "insert") {
          if (state.insertError) return { data: null, error: state.insertError };
          state.payment = "succeeded";
          return { data: null, error: null };
        }
        if (table === "payments") return { data: state.payment ? { status: state.payment } : null, error: null };
        if (table === "properties" && op.op === "select") {
          return { data: { address_street: "1 A St", address_city: "Miami", address_state: "FL", address_zip: "33130", list_price: 1, pricing_tier: "pro", owner_id: "u1" }, error: null };
        }
        return { data: null, error: null };
      };
      for (const m of ["select", "order", "limit"]) b[m] = () => b;
      b.eq = (f: string, v: unknown) => (filters.push(["eq", f, v]), b);
      b.neq = (f: string, v: unknown) => (filters.push(["neq", f, v]), b);
      b.update = (p: unknown) => ((op.op = "update"), (op.payload = p), b);
      b.insert = (p: unknown) => ((op.op = "insert"), (op.payload = p), Promise.resolve(run()));
      b.maybeSingle = async () => run();
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, ops };
}

const session = (over: Partial<Stripe.Checkout.Session> = {}) =>
  ({
    id: "cs_test_a",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 49500,
    currency: "usd",
    livemode: false,
    metadata: { property_id: "p1", tier: "pro", user_id: "u1", lang: "es" },
    ...over,
  }) as Stripe.Checkout.Session;

beforeEach(() => vi.clearAllMocks());

describe("fulfillTierCheckout: una vez por sesión (webhook + regreso del paso 8)", () => {
  it("primera llamada: marca el pago, pasa a pending_approval y hace los efectos una vez", async () => {
    const { db, ops } = fakeDb({ payment: "pending" });
    expect(await fulfillTierCheckout(db, session())).toBe("fulfilled");
    expect(ops.some((o) => o.table === "properties" && o.op === "update")).toBe(true);
    expect(recordFunnelEvent).toHaveBeenCalledOnce();
    // lang de la metadata de Stripe (checkoutAttribution), no de seller_leads.
    expect(recordFunnelEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "listing_paid", metadata: expect.objectContaining({ lang: "es" }) }),
    );
    expect(sendPaymentReceipt).toHaveBeenCalledOnce();
    expect(sendGa4Purchase).toHaveBeenCalledOnce();
  });

  it("segunda llamada (el otro camino llega después): 'already', sin repetir correos ni eventos", async () => {
    const state = { payment: "pending" as string | null };
    const { db } = fakeDb(state);
    await fulfillTierCheckout(db, session());
    vi.clearAllMocks();
    const second = fakeDb(state);
    expect(await fulfillTierCheckout(second.db, session())).toBe("already");
    expect(second.ops.some((o) => o.table === "properties" && o.op === "update")).toBe(false);
    expect(recordFunnelEvent).not.toHaveBeenCalled();
    expect(sendPaymentReceipt).not.toHaveBeenCalled();
    expect(sendBrokerNewPending).not.toHaveBeenCalled();
    expect(sendGa4Purchase).not.toHaveBeenCalled();
  });

  it("sin pagar → no toca nada", async () => {
    const { db, ops } = fakeDb({ payment: "pending" });
    expect(await fulfillTierCheckout(db, session({ payment_status: "unpaid" }))).toBe("not_paid");
    expect(ops).toEqual([]);
  });

  it("sin fila de pago: la crea; si otra inserción ganó (23505) → 'already'", async () => {
    const created = fakeDb({ payment: null });
    expect(await fulfillTierCheckout(created.db, session())).toBe("fulfilled");
    expect(created.ops.some((o) => o.table === "payments" && o.op === "insert")).toBe(true);

    vi.clearAllMocks();
    const raced = fakeDb({ payment: null, insertError: { code: "23505" } });
    expect(await fulfillTierCheckout(raced.db, session())).toBe("already");
    expect(sendPaymentReceipt).not.toHaveBeenCalled();
  });

  it("isTierSession: solo el plan, no consulta / fotografía / staging", () => {
    expect(isTierSession(session())).toBe(true);
    expect(isTierSession(session({ metadata: { kind: "photography", property_id: "p1" } }))).toBe(false);
    expect(isTierSession(session({ metadata: { kind: "consultation" } }))).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveListingRequest, rejectListingRequest } from "./listing-requests.server";

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

function fake(respond: (c: Call) => { data: unknown; error: unknown }, calls: Call[]) {
  return {
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [] };
      const result = () => (calls.push(call), Promise.resolve(respond(call)));
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => ((call.op = "insert"), (call.payload = p), b),
        update: (p: unknown) => ((call.op = "update"), (call.payload = p), b),
        eq: (k: string, v: unknown) => (call.filters.push([k, v]), b),
        in: (k: string, v: unknown) => (call.filters.push([k, v]), b),
        maybeSingle: result,
        single: result,
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => result().then(ok, ko),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const PID = "p1";
const args = { requestId: "r1", propertyId: PID, reviewerId: "broker", note: null };

describe("approveListingRequest", () => {
  it("cambio: reclama la solicitud, aplica los valores, cierra la tarea y deja log", async () => {
    const calls: Call[] = [];
    const sb = fake((c) => {
      if (c.table === "listing_requests" && c.op === "update" && c.filters.some(([k, v]) => k === "status" && v === "pending")) {
        return { data: { id: "r1", property_id: PID, kind: "change", changes: { list_price: { old: 5, new: 4 } }, broker_task_id: "t1" }, error: null };
      }
      if (c.table === "properties") return { data: { id: PID }, error: null };
      return { data: null, error: null };
    }, calls);
    expect(await approveListingRequest(sb, args)).toEqual({ ok: true });
    const upd = calls.find((c) => c.table === "properties")!;
    expect(upd.payload).toEqual({ list_price: 4 });
    expect(calls.find((c) => c.table === "broker_tasks")!.filters).toContainEqual(["id", "t1"]);
    expect(calls.some((c) => c.table === "activity_log")).toBe(true);
  });

  it("retiro: pone withdrawn y cancela los cambios pendientes", async () => {
    const calls: Call[] = [];
    const sb = fake((c) => {
      if (c.table === "listing_requests" && c.op === "update" && (c.payload as { status: string }).status === "approved") {
        return { data: { id: "r1", property_id: PID, kind: "withdrawal", changes: {}, broker_task_id: null }, error: null };
      }
      if (c.table === "properties") return { data: { id: PID }, error: null };
      return { data: null, error: null };
    }, calls);
    expect(await approveListingRequest(sb, args)).toEqual({ ok: true });
    expect(calls.find((c) => c.table === "properties")!.payload).toEqual({ mls_status: "withdrawn" });
    const cancel = calls.find((c) => c.table === "listing_requests" && (c.payload as { status?: string })?.status === "cancelled")!;
    expect(cancel.filters).toContainEqual(["kind", "change"]);
  });

  it("ya resuelta → not_pending, no toca properties", async () => {
    const calls: Call[] = [];
    const sb = fake(() => ({ data: null, error: null }), calls);
    expect(await approveListingRequest(sb, args)).toEqual({ ok: false, error: "not_pending" });
    expect(calls.some((c) => c.table === "properties")).toBe(false);
  });

  it("si properties falla, la solicitud vuelve a pending", async () => {
    const calls: Call[] = [];
    const sb = fake((c) => {
      if (c.table === "listing_requests" && (c.payload as { status?: string })?.status === "approved") {
        return { data: { id: "r1", property_id: PID, kind: "change", changes: { list_price: { old: 5, new: 4 } }, broker_task_id: null }, error: null };
      }
      if (c.table === "properties") return { data: null, error: { message: "denied" } };
      return { data: null, error: null };
    }, calls);
    expect(await approveListingRequest(sb, args)).toEqual({ ok: false, error: "apply_failed" });
    expect(calls.some((c) => c.table === "listing_requests" && (c.payload as { status?: string })?.status === "pending")).toBe(true);
  });
});

describe("rejectListingRequest", () => {
  it("rechaza sin tocar properties", async () => {
    const calls: Call[] = [];
    const sb = fake((c) =>
      c.table === "listing_requests" ? { data: { id: "r1", kind: "change", broker_task_id: "t1" }, error: null } : { data: null, error: null },
    calls);
    expect(await rejectListingRequest(sb, { ...args, note: "Not now" })).toEqual({ ok: true });
    expect(calls.some((c) => c.table === "properties")).toBe(false);
    expect((calls[0].payload as { status: string; review_note: string })).toMatchObject({ status: "rejected", review_note: "Not now" });
  });
});

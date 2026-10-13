import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleListingRequest, type ListingRequestDeps } from "./listing-request-route";

const PID = "aaaaaaaa-0000-4000-8000-000000000006";
const SELLER = "11111111-1111-4111-8111-111111111111";

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
type Responder = (c: Call) => { data: unknown; error: unknown };

/** Cliente falso: encadena como supabase-js y responde según `respond`. */
function fakeClient(respond: Responder, user: { id: string } | null, calls: Call[] = []) {
  const builder = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const result = () => {
      calls.push(call);
      return Promise.resolve(respond(call));
    };
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
  };
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: builder,
  } as unknown as SupabaseClient;
}

const activeListing = {
  id: PID, owner_id: SELLER, mls_status: "active", is_test: false,
  address_street: "1 Ocean Dr", address_city: "Miami Beach", list_price: 500000, description: "Old",
};

function deps(opts: {
  user?: { id: string } | null;
  property?: Record<string, unknown> | null;
  insertError?: { code: string } | null;
  limited?: boolean;
}) {
  const svcCalls: Call[] = [];
  const notifyBroker = vi.fn(async () => ({ ok: true }));
  const d: ListingRequestDeps = {
    sessionClient: async () =>
      fakeClient(() => ({ data: opts.property === undefined ? activeListing : opts.property, error: null }),
        opts.user === undefined ? { id: SELLER } : opts.user),
    serviceClient: () =>
      fakeClient((c) => {
        if (c.table === "listing_requests" && c.op === "insert") {
          return opts.insertError ? { data: null, error: opts.insertError } : { data: { id: "req-1" }, error: null };
        }
        if (c.table === "broker_tasks") return { data: { id: "task-1" }, error: null };
        return { data: null, error: null };
      }, null, svcCalls),
    limit: async () => (opts.limited ? Response.json({ error: "rate_limited" }, { status: 429 }) : null),
    notifyBroker: notifyBroker as unknown as ListingRequestDeps["notifyBroker"],
  };
  return { d, svcCalls, notifyBroker };
}

const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("POST /api/listings/[id]/change-request (#136)", () => {
  it("sin sesión → 401", async () => {
    const { d } = deps({ user: null });
    expect((await handleListingRequest(req({}), PID, "change", d)).status).toBe(401);
  });

  it("rate limit → 429", async () => {
    const { d } = deps({ limited: true });
    expect((await handleListingRequest(req({}), PID, "change", d)).status).toBe(429);
  });

  it("listing ajeno o inexistente → 404 (sin revelar cuál)", async () => {
    const { d: ajeno } = deps({ property: { ...activeListing, owner_id: "otro" } });
    const { d: nada } = deps({ property: null });
    expect((await handleListingRequest(req({ changes: { list_price: 1 } }), PID, "change", ajeno)).status).toBe(404);
    expect((await handleListingRequest(req({ changes: { list_price: 1 } }), PID, "change", nada)).status).toBe(404);
    expect((await handleListingRequest(req({}), "no-uuid", "change", nada)).status).toBe(404);
  });

  it("borrador → 409 (se edita directo)", async () => {
    const { d } = deps({ property: { ...activeListing, mls_status: "draft" } });
    const res = await handleListingRequest(req({ changes: { list_price: 1 } }), PID, "change", d);
    expect(res.status).toBe(409);
  });

  it("campo no permitido o sin cambios → 400", async () => {
    const { d } = deps({});
    const r1 = await handleListingRequest(req({ changes: { mls_status: "withdrawn" } }), PID, "change", d);
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ error: "unknown_field", field: "mls_status" });
    const r2 = await handleListingRequest(req({ changes: { list_price: 500000 } }), PID, "change", d);
    expect(await r2.json()).toEqual({ error: "no_changes" });
  });

  it("válido → 201: crea solicitud + tarea + log, avisa a la broker, NO toca properties", async () => {
    const { d, svcCalls, notifyBroker } = deps({});
    const res = await handleListingRequest(
      req({ changes: { list_price: 480000 }, reason: "Market" }), PID, "change", d);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "req-1", status: "pending" });

    const insert = svcCalls.find((c) => c.table === "listing_requests" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({
      property_id: PID, kind: "change", requested_by: SELLER, reason: "Market",
      changes: { list_price: { old: 500000, new: 480000 } },
    });
    const task = svcCalls.find((c) => c.table === "broker_tasks")!;
    expect(task.payload).toMatchObject({ task_type: "review_listing_change", property_id: PID, status: "pending" });
    expect(svcCalls.some((c) => c.table === "activity_log" && c.op === "insert")).toBe(true);
    expect(svcCalls.some((c) => c.table === "properties")).toBe(false);
    expect(notifyBroker).toHaveBeenCalledWith(expect.objectContaining({ kind: "change", requestId: "req-1" }));
  });

  it("ya hay una pendiente → 409 request_pending, sin tarea duplicada", async () => {
    const { d, svcCalls } = deps({ insertError: { code: "23505" } });
    const res = await handleListingRequest(req({ changes: { list_price: 480000 } }), PID, "change", d);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "request_pending" });
    expect(svcCalls.some((c) => c.table === "broker_tasks")).toBe(false);
  });
});

describe("POST /api/listings/[id]/withdrawal-request (#134)", () => {
  it("activo → 201 con tarea withdraw_listing de prioridad alta; no escribe el estado", async () => {
    const { d, svcCalls } = deps({});
    const res = await handleListingRequest(req({ reason: "Sold privately" }), PID, "withdrawal", d);
    expect(res.status).toBe(201);
    const task = svcCalls.find((c) => c.table === "broker_tasks")!;
    expect(task.payload).toMatchObject({ task_type: "withdraw_listing", priority: "high" });
    const insert = svcCalls.find((c) => c.table === "listing_requests" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({ kind: "withdrawal", changes: {}, reason: "Sold privately" });
    expect(svcCalls.some((c) => c.table === "properties")).toBe(false);
  });

  it("bajo contrato o ya retirado → 409 not_withdrawable", async () => {
    for (const s of ["under_contract", "withdrawn", "draft"]) {
      const { d } = deps({ property: { ...activeListing, mls_status: s } });
      const res = await handleListingRequest(req({}), PID, "withdrawal", d);
      expect(res.status, s).toBe(409);
      expect((await res.json()).error).toBe("not_withdrawable");
    }
  });
});

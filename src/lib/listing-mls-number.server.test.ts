import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureEnterMlsNumberTask, mapMlsNumberWriteError, saveListingMlsNumber,
} from "./listing-mls-number.server";

/** Cliente falso que registra cada llamada encadenada por tabla. */
function fakeClient(opts: {
  pendingTask?: boolean;
  updateResult?: { data: unknown; error: { code?: string; message?: string } | null };
} = {}) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, in: chain, limit: chain,
        insert: (payload: unknown) => { calls.push({ table, op: "insert", payload }); return Promise.resolve({ error: null }); },
        update: (payload: unknown) => { calls.push({ table, op: "update", payload }); return q; },
        maybeSingle: () => Promise.resolve(
          table === "broker_tasks"
            ? { data: opts.pendingTask ? { id: "t1" } : null, error: null }
            : opts.updateResult ?? { data: { id: "p1" }, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
      });
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("ensureEnterMlsNumberTask", () => {
  it("crea la tarea enter_mls_number si no hay una pendiente", async () => {
    const { client, calls } = fakeClient();
    await ensureEnterMlsNumberTask(client, "p1", "1 Main St, Miami");
    const ins = calls.find((c) => c.op === "insert");
    expect(ins?.table).toBe("broker_tasks");
    expect(ins?.payload).toMatchObject({ property_id: "p1", task_type: "enter_mls_number", status: "pending" });
  });

  it("no duplica la tarea si ya hay una pendiente", async () => {
    const { client, calls } = fakeClient({ pendingTask: true });
    await ensureEnterMlsNumberTask(client, "p1", "1 Main St, Miami");
    expect(calls.filter((c) => c.op === "insert")).toEqual([]);
  });
});

describe("saveListingMlsNumber", () => {
  it("guarda normalizado, cierra la tarea y deja rastro", async () => {
    const { client, calls } = fakeClient();
    const r = await saveListingMlsNumber(client, { propertyId: "p1", raw: " a1123 4567", userId: "u1" });
    expect(r).toEqual({ ok: true, value: "A11234567" });
    expect(calls).toContainEqual({ table: "properties", op: "update", payload: { mls_number: "A11234567" } });
    expect(calls.find((c) => c.table === "broker_tasks" && c.op === "update")?.payload)
      .toMatchObject({ status: "completed" });
    expect(calls.find((c) => c.table === "activity_log")?.payload).toMatchObject({ action_type: "mls_number_set" });
  });

  it("formato inválido: no escribe nada", async () => {
    const { client, calls } = fakeClient();
    expect(await saveListingMlsNumber(client, { propertyId: "p1", raw: "nope", userId: "u1" }))
      .toEqual({ ok: false, error: "invalid_format" });
    expect(calls).toEqual([]);
  });

  it("número de otra propiedad (UNIQUE) → taken, sin cerrar la tarea", async () => {
    const { client, calls } = fakeClient({ updateResult: { data: null, error: { code: "23505" } } });
    expect(await saveListingMlsNumber(client, { propertyId: "p1", raw: "A11234567", userId: "u1" }))
      .toEqual({ ok: false, error: "taken" });
    expect(calls.filter((c) => c.table === "broker_tasks")).toEqual([]);
  });

  it("fila no actualizada (RLS / trigger / inexistente) → failed", async () => {
    const { client } = fakeClient({ updateResult: { data: null, error: null } });
    expect(await saveListingMlsNumber(client, { propertyId: "p1", raw: "A11234567", userId: "u1" }))
      .toEqual({ ok: false, error: "failed" });
  });
});

describe("mapMlsNumberWriteError", () => {
  it("23505 → taken; otro → failed; null → null", () => {
    expect(mapMlsNumberWriteError({ code: "23505" })).toBe("taken");
    expect(mapMlsNumberWriteError({ code: "42501" })).toBe("failed");
    expect(mapMlsNumberWriteError(null)).toBeNull();
    vi.restoreAllMocks();
  });
});

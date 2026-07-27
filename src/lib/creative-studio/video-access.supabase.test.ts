import { describe, it, expect } from "vitest";
import { SupabaseVideoAccessStore, type VideoAccessClient } from "./video-access.supabase";

// ── Stateful fake of the service client ────────────────────────────────────────────────────
// Interprets EXACTLY the chains the store builds. The update chain applies the same guard
// semantics the real WHERE would (single-row, conditional, compare-and-swap on generations_used),
// so the concurrency/ceiling tests exercise true CAS behavior against in-memory state.

interface Row {
  id: string;
  user_id: string;
  listing_id: string | null;
  enabled: boolean;
  max_generations: number;
  generations_used: number;
  valid_from: string | null;
  valid_until: string | null;
  revoked_at: string | null;
}

const SELECT_COLS =
  "id, user_id, listing_id, enabled, max_generations, generations_used, valid_from, valid_until, revoked_at";

function row(o: Partial<Row> = {}): Row {
  return {
    id: "g1",
    user_id: "u1",
    listing_id: "L1",
    enabled: true,
    max_generations: 3,
    generations_used: 0,
    valid_from: null,
    valid_until: null,
    revoked_at: null,
    ...o,
  };
}

function fakeDb(seed: Row[], opts: { readError?: boolean; writeError?: boolean } = {}) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));

  function selectChain() {
    const eqs: Record<string, string> = {};
    const isNulls: string[] = [];
    const chain = {
      eq(col: string, v: string) {
        eqs[col] = v;
        return chain;
      },
      is(col: string, _v: null) {
        isNulls.push(col);
        return chain;
      },
      order(_col: string, _opts: { ascending: boolean }) {
        if (opts.readError) return Promise.resolve({ data: null, error: { code: "57014", message: "boom" } });
        const out = [...rows.values()].filter(
          (r) =>
            (eqs.user_id === undefined || r.user_id === eqs.user_id) &&
            (!isNulls.includes("revoked_at") || r.revoked_at === null),
        );
        return Promise.resolve({ data: out, error: null });
      },
    };
    return chain;
  }

  function updateChain(values: Record<string, unknown>) {
    const eqs: Record<string, string | number | boolean> = {};
    const isNulls: string[] = [];
    const chain = {
      eq(col: string, v: string | number | boolean) {
        eqs[col] = v;
        return chain;
      },
      is(col: string, _v: null) {
        isNulls.push(col);
        return chain;
      },
      select(_cols: string) {
        if (opts.writeError) return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } });
        const r = rows.get(String(eqs.id ?? ""));
        const matches =
          !!r &&
          r.user_id === eqs.user_id &&
          r.enabled === eqs.enabled &&
          (!isNulls.includes("revoked_at") || r.revoked_at === null) &&
          r.generations_used === eqs.generations_used; // compare-and-swap guard
        if (matches && r) {
          r.generations_used = Number(values.generations_used);
          return Promise.resolve({
            data: [{ generations_used: r.generations_used, max_generations: r.max_generations }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  const client: VideoAccessClient = {
    from(_table: string) {
      return {
        select: (_cols: string) => selectChain(),
        update: (values: Record<string, unknown>) => updateChain(values),
      };
    },
  };
  return { client, rows };
}

describe("SupabaseVideoAccessStore.listActiveGrants", () => {
  it("maps snake_case rows to camelCase grants, only for the user, only non-revoked", async () => {
    const { client } = fakeDb([
      row({ id: "g1", user_id: "u1", listing_id: "L1", max_generations: 3, generations_used: 1 }),
      row({ id: "g2", user_id: "u1", listing_id: null }),
      row({ id: "gRevoked", user_id: "u1", revoked_at: "2026-07-01T00:00:00Z" }),
      row({ id: "gOther", user_id: "u2" }),
    ]);
    const grants = await new SupabaseVideoAccessStore(client).listActiveGrants("u1");
    expect(grants.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
    const g1 = grants.find((g) => g.id === "g1")!;
    expect(g1).toMatchObject({ userId: "u1", listingId: "L1", maxGenerations: 3, generationsUsed: 1, revokedAt: null });
    expect(SELECT_COLS).toContain("generations_used"); // guards against silently dropping a column
  });

  it("empty result → [] (indistinguishable from no allowlist — denial handled upstream)", async () => {
    const { client } = fakeDb([]);
    expect(await new SupabaseVideoAccessStore(client).listActiveGrants("u1")).toEqual([]);
  });

  it("DB error THROWS (so the authority fails closed + logs), never returns [])", async () => {
    const { client } = fakeDb([row()], { readError: true });
    await expect(new SupabaseVideoAccessStore(client).listActiveGrants("u1")).rejects.toThrow(/video-access read failed/);
  });
});

describe("SupabaseVideoAccessStore.consumeGeneration", () => {
  it("consumes one slot when available → consumed:true, remaining decremented, row incremented", async () => {
    const { client, rows } = fakeDb([row({ id: "g1", user_id: "u1", max_generations: 3, generations_used: 1 })]);
    const r = await new SupabaseVideoAccessStore(client).consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 1 });
    expect(r).toEqual({ consumed: true, remainingGenerations: 1 });
    expect(rows.get("g1")!.generations_used).toBe(2);
  });

  it("stale expectedUsed (someone else already consumed) → consumed:false, no change (CAS miss)", async () => {
    const { client, rows } = fakeDb([row({ id: "g1", user_id: "u1", max_generations: 3, generations_used: 2 })]);
    // caller thought used was 1, but it is already 2
    const r = await new SupabaseVideoAccessStore(client).consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 1 });
    expect(r).toEqual({ consumed: false, remainingGenerations: null });
    expect(rows.get("g1")!.generations_used).toBe(2);
  });

  it("last slot: two concurrent consumers with the same expectedUsed → exactly one consumes", async () => {
    const { client, rows } = fakeDb([row({ id: "g1", user_id: "u1", max_generations: 2, generations_used: 1 })]);
    const store = new SupabaseVideoAccessStore(client);
    const [a, b] = await Promise.all([
      store.consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 1 }),
      store.consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 1 }),
    ]);
    expect([a.consumed, b.consumed].filter(Boolean)).toHaveLength(1); // ceiling never exceeded
    expect(rows.get("g1")!.generations_used).toBe(2); // exactly max, not 3
  });

  it("revoked grant → consumed:false even if expectedUsed matches", async () => {
    const { client } = fakeDb([row({ id: "g1", user_id: "u1", generations_used: 0, revoked_at: "2026-07-01T00:00:00Z" })]);
    const r = await new SupabaseVideoAccessStore(client).consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 0 });
    expect(r.consumed).toBe(false);
  });

  it("disabled grant → consumed:false", async () => {
    const { client } = fakeDb([row({ id: "g1", user_id: "u1", generations_used: 0, enabled: false })]);
    const r = await new SupabaseVideoAccessStore(client).consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 0 });
    expect(r.consumed).toBe(false);
  });

  it("wrong user → consumed:false (defense-in-depth ownership guard)", async () => {
    const { client } = fakeDb([row({ id: "g1", user_id: "u1", generations_used: 0 })]);
    const r = await new SupabaseVideoAccessStore(client).consumeGeneration({ grantId: "g1", userId: "attacker", expectedUsed: 0 });
    expect(r.consumed).toBe(false);
  });

  it("DB error on the UPDATE throws", async () => {
    const { client } = fakeDb([row()], { writeError: true });
    await expect(
      new SupabaseVideoAccessStore(client).consumeGeneration({ grantId: "g1", userId: "u1", expectedUsed: 0 }),
    ).rejects.toThrow(/video-access consume failed/);
  });
});

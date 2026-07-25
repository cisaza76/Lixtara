import { describe, it, expect, vi } from "vitest";
import { SupabaseAssetStore, UniqueViolationError } from "@/lib/assets/asset-store.supabase";
import type { NewAsset } from "@/lib/assets/types";

// Minimal hand-written fake of the Postgrest query-builder chain SupabaseAssetStore
// calls: eq/order/select return the SAME builder (chainable) which is ALSO directly
// awaitable (mirrors the real @supabase/supabase-js builder) and exposes a terminal
// `.maybeSingle()`. No network — `result` is the canned `{data, error}` this builder
// always resolves to, regardless of how many filters were chained first.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder = {
    eq: vi.fn((...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return builder;
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.push({ method: "order", args });
      return builder;
    }),
    select: vi.fn((...args: unknown[]) => {
      calls.push({ method: "select", args });
      return builder;
    }),
    maybeSingle: vi.fn(async () => result),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { builder, calls };
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const { builder, calls } = makeBuilder(result);
  const insertCalls: unknown[] = [];
  const from = vi.fn((_table: string) => ({
    insert: vi.fn((row: unknown) => {
      insertCalls.push(row);
      return builder;
    }),
    select: builder.select,
  }));
  return { from, calls, insertCalls, builder };
}

const provenance = {
  sourceAssetIds: [] as string[],
  capability: "photo",
  engine: "asset-manager",
  provider: "seller_upload",
  prompt: null,
};

const newAsset: NewAsset = {
  listingId: "L1",
  ownerId: "O1",
  kind: "photo",
  version: 1,
  parentAsset: null,
  sourceType: "property_photo",
  sourceId: "p1",
  provenance,
  storageBucket: "b",
  storagePath: "L1/p1.jpg",
  checksum: null,
  bytes: 100,
  mime: "image/jpeg",
  costUsd: 0,
  costProvider: null,
  createdBy: "O1",
  lifecycle: "approved",
  qa: null,
  policy: null,
};

const assetRow = {
  id: "a1",
  listing_id: "L1",
  owner_id: "O1",
  kind: "photo",
  version: 1,
  parent_asset: null,
  source_type: "property_photo",
  source_id: "p1",
  provenance,
  storage_bucket: "b",
  storage_path: "L1/p1.jpg",
  checksum: null,
  bytes: 100,
  mime: "image/jpeg",
  cost_usd: 0,
  cost_provider: null,
  created_by: "O1",
  lifecycle: "approved",
  qa: null,
  policy: null,
  created_at: "2026-07-15T00:00:00.000Z",
};

describe("SupabaseAssetStore.insert", () => {
  it("maps NewAsset (camelCase) to the assets row (snake_case) on write", async () => {
    const { from, insertCalls } = fakeClient({ data: assetRow, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    await store.insert(newAsset);
    expect(insertCalls[0]).toMatchObject({
      listing_id: "L1",
      owner_id: "O1",
      kind: "photo",
      source_type: "property_photo",
      source_id: "p1",
      storage_bucket: "b",
      storage_path: "L1/p1.jpg",
      cost_usd: 0,
      created_by: "O1",
      lifecycle: "approved",
    });
  });

  it("maps the returned row (snake_case) back to Asset (camelCase)", async () => {
    const { from } = fakeClient({ data: assetRow, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    const asset = await store.insert(newAsset);
    expect(asset).toEqual({
      id: "a1",
      listingId: "L1",
      ownerId: "O1",
      kind: "photo",
      version: 1,
      parentAsset: null,
      sourceType: "property_photo",
      sourceId: "p1",
      provenance,
      storageBucket: "b",
      storagePath: "L1/p1.jpg",
      checksum: null,
      bytes: 100,
      mime: "image/jpeg",
      costUsd: 0,
      costProvider: null,
      createdBy: "O1",
      lifecycle: "approved",
      qa: null,
      policy: null,
      createdAt: "2026-07-15T00:00:00.000Z",
    });
  });

  it("surfaces a 23505 unique violation as UniqueViolationError (caller-detectable)", async () => {
    const { from } = fakeClient({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "assets_source_unique"' },
    });
    const store = new SupabaseAssetStore({ from } as never);
    await expect(store.insert(newAsset)).rejects.toThrow(UniqueViolationError);
  });

  it("throws a plain error for a non-unique-violation failure", async () => {
    const { from } = fakeClient({ data: null, error: { code: "42P01", message: "relation does not exist" } });
    const store = new SupabaseAssetStore({ from } as never);
    await expect(store.insert(newAsset)).rejects.not.toThrow(UniqueViolationError);
    await expect(store.insert(newAsset)).rejects.toThrow(/relation does not exist/);
  });
});

describe("SupabaseAssetStore.findBySource", () => {
  it("filters by BOTH source_type and source_id, and maps the row back", async () => {
    const { from, calls } = fakeClient({ data: assetRow, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    const asset = await store.findBySource("property_photo", "p1");
    expect(calls).toEqual([
      { method: "select", args: ["*"] },
      { method: "eq", args: ["source_type", "property_photo"] },
      { method: "eq", args: ["source_id", "p1"] },
    ]);
    expect(asset?.id).toBe("a1");
  });

  it("returns null when no row matches", async () => {
    const { from } = fakeClient({ data: null, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    const asset = await store.findBySource("property_photo", "missing");
    expect(asset).toBeNull();
  });
});

describe("SupabaseAssetStore.listByListing", () => {
  it("filters by listing_id and maps every row", async () => {
    const { from, calls } = fakeClient({ data: [assetRow, { ...assetRow, id: "a2" }], error: null });
    const store = new SupabaseAssetStore({ from } as never);
    const assets = await store.listByListing("L1");
    expect(calls).toEqual(expect.arrayContaining([{ method: "eq", args: ["listing_id", "L1"] }]));
    expect(assets.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty array when no rows match", async () => {
    const { from } = fakeClient({ data: null, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    expect(await store.listByListing("L-empty")).toEqual([]);
  });
});

describe("SupabaseAssetStore.getById", () => {
  it("filters by id and maps the row back", async () => {
    const { from, calls } = fakeClient({ data: assetRow, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    const asset = await store.getById("a1");
    expect(calls).toEqual(expect.arrayContaining([{ method: "eq", args: ["id", "a1"] }]));
    expect(asset?.id).toBe("a1");
  });

  it("returns null when the id doesn't exist", async () => {
    const { from } = fakeClient({ data: null, error: null });
    const store = new SupabaseAssetStore({ from } as never);
    expect(await store.getById("missing")).toBeNull();
  });
});

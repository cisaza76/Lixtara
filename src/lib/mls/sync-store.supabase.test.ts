import { describe, it, expect, vi, beforeEach } from "vitest";

// El upsert del sync va en tandas de UPSERT_CHUNK: una página entera en una sola sentencia
// superó el statement_timeout de la base el 2026-10-10.
const tandas: number[] = [];
let fallarEn = -1;
vi.mock("@/lib/supabase/service", () => ({
  createService: () => ({
    from: () => ({
      upsert: async (rows: unknown[]) => {
        tandas.push(rows.length);
        return { error: tandas.length - 1 === fallarEn ? { message: "statement timeout" } : null };
      },
    }),
  }),
}));

import { UPSERT_CHUNK, createSupabaseSyncStore } from "./sync-store.supabase";
import type { NormalizedListing } from "@/lib/mls/feed-port";

const filas = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ listing_key: `K${i}` }) as unknown as NormalizedListing);

beforeEach(() => { tandas.length = 0; fallarEn = -1; });

describe("upsertListings", () => {
  it("parte una página de 200 en tandas de UPSERT_CHUNK", async () => {
    const n = await createSupabaseSyncStore().upsertListings(filas(200));
    expect(n).toBe(200);
    expect(tandas).toEqual(Array(200 / UPSERT_CHUNK).fill(UPSERT_CHUNK));
  });

  it("una tanda fallida lanza y no sigue con las demás", async () => {
    fallarEn = 1;
    await expect(createSupabaseSyncStore().upsertListings(filas(200))).rejects.toThrow(/statement timeout/);
    expect(tandas).toHaveLength(2);
  });

  it("nada que escribir, ninguna sentencia", async () => {
    expect(await createSupabaseSyncStore().upsertListings([])).toBe(0);
    expect(tandas).toEqual([]);
  });
});

// Paso 1 de /listing/new: un segundo envío seguido no crea otro borrador (2026-10-20: dos
// borradores del mismo dueño, 1,5 s de diferencia). Supabase simulado: sin red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STEP1_DEDUPE_WINDOW_MS, recentOwnDraftId } from "./listing-step1-dedupe.server";

function fakeDb(result: { data: unknown; error: unknown } | Error) {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "order", "limit"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
  q.maybeSingle = async () => {
    if (result instanceof Error) throw result;
    return result;
  };
  const db = { from: (t: string) => (calls.push(["from", t]), q) } as unknown as SupabaseClient;
  return { db, calls };
}

const now = new Date("2026-10-20T22:33:27.670Z");

describe("paso 1: no crear un segundo borrador seguido", () => {
  it("busca el borrador más nuevo del mismo dueño, en draft, de los últimos 2 minutos", async () => {
    const { db, calls } = fakeDb({ data: { id: "p1" }, error: null });
    expect(await recentOwnDraftId(db, "u1", now)).toBe("p1");
    expect(STEP1_DEDUPE_WINDOW_MS).toBe(120_000);
    expect(calls).toEqual([
      ["from", "properties"],
      ["select", "id"],
      ["eq", "owner_id", "u1"],
      ["eq", "mls_status", "draft"],
      ["gte", "created_at", "2026-10-20T22:31:27.670Z"],
      ["order", "created_at", { ascending: false }],
      ["limit", 1],
    ]);
  });

  it("sin borrador reciente, o si la lectura falla, se crea uno nuevo como siempre", async () => {
    expect(await recentOwnDraftId(fakeDb({ data: null, error: null }).db, "u1", now)).toBeNull();
    expect(await recentOwnDraftId(fakeDb({ data: null, error: { message: "x" } }).db, "u1", now)).toBeNull();
    expect(await recentOwnDraftId(fakeDb(new Error("network")).db, "u1", now)).toBeNull();
  });

  it("saveStep1 reutiliza ese borrador, el botón se desactiva al enviar y Enter en una sugerencia no envía", () => {
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page).toContain("const existingId = id || (await recentOwnDraftId(supabase, user.id));");
    expect(page).toContain("<PendingSubmitButton>{copy.nextLabel} →</PendingSubmitButton>");
    expect(readFileSync("src/components/pending-submit-button.tsx", "utf8")).toContain("disabled={pending}");
    expect(readFileSync("src/components/address-autocomplete.tsx", "utf8")).toContain(
      'if (e.key === "Enter" && suggestionsOpen()) e.preventDefault();',
    );
  });
});

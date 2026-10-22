// Paso 1 de /listing/new: un segundo envío seguido con la MISMA dirección no crea otro
// borrador (2026-10-20: dos borradores del mismo dueño, 1,5 s de diferencia); otra dirección
// sí, aunque sea enseguida. Tabla `properties` simulada en memoria: sin red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STEP1_DEDUPE_WINDOW_MS, duplicateDraftId, normalizedAddressKey } from "./listing-step1-dedupe.server";

type Row = { id: string; owner_id: string; mls_status: string; address_street: string; address_zip: string; created_at: string };

/** Supabase simulado sobre `rows`: aplica los mismos eq/gte/order/limit que la consulta real. */
function fakeDb(rows: Row[]): SupabaseClient {
  return {
    from: () => {
      let out = [...rows];
      let n = Infinity;
      const q = {
        select: () => q,
        eq: (c: keyof Row, v: string) => ((out = out.filter((r) => r[c] === v)), q),
        gte: (c: keyof Row, v: string) => ((out = out.filter((r) => r[c] >= v)), q),
        order: () => ((out = out.sort((a, b) => b.created_at.localeCompare(a.created_at))), q),
        limit: (k: number) => ((n = k), q),
        then: (res: (v: unknown) => unknown) => res({ data: out.slice(0, n), error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

/** Lo que hace saveStep1 sin id: actualizar el duplicado o insertar uno nuevo. */
async function send(rows: Row[], owner: string, street: string, zip: string, at: Date): Promise<string> {
  const dup = await duplicateDraftId(fakeDb(rows), owner, { street, zip }, at);
  if (dup) {
    Object.assign(rows.find((r) => r.id === dup)!, { address_street: street, address_zip: zip });
    return dup;
  }
  const id = `p${rows.length + 1}`;
  rows.push({ id, owner_id: owner, mls_status: "draft", address_street: street, address_zip: zip, created_at: at.toISOString() });
  return id;
}

const t0 = new Date("2026-10-20T22:33:26.171Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

describe("paso 1: mismo dueño + misma dirección + menos de 2 minutos → el mismo borrador", () => {
  it("(a) dos envíos con la misma dirección → 1 listing", async () => {
    const rows: Row[] = [];
    const a = await send(rows, "u1", "100 NE 1st Avenue", "33132", t0);
    const b = await send(rows, "u1", "100 N.E. 1st Ave", "33132-1234", later(1_500));
    expect(b).toBe(a);
    expect(rows).toHaveLength(1);
  });

  it("(b) dos direcciones distintas en menos de 2 min → 2 listings, sin que una pise a la otra", async () => {
    const rows: Row[] = [];
    const a = await send(rows, "u1", "100 NE 1st Ave", "33132", t0);
    const b = await send(rows, "u1", "250 SW 8th St", "33130", later(30_000));
    expect(b).not.toBe(a);
    expect(rows.map((r) => [r.id, r.address_street])).toEqual([[a, "100 NE 1st Ave"], [b, "250 SW 8th St"]]);
  });

  it("(b) otra unidad del mismo edificio es otra dirección", async () => {
    const rows: Row[] = [];
    await send(rows, "u1", "100 NE 1st Ave, Unit 4", "33132", t0);
    await send(rows, "u1", "100 NE 1st Ave, Unit 5", "33132", later(10_000));
    expect(rows).toHaveLength(2);
  });

  it("(c) la misma dirección después de 2 min → un listing nuevo, como antes de este cambio", async () => {
    const rows: Row[] = [];
    const a = await send(rows, "u1", "100 NE 1st Ave", "33132", t0);
    const b = await send(rows, "u1", "100 NE 1st Ave", "33132", later(STEP1_DEDUPE_WINDOW_MS + 1));
    expect(b).not.toBe(a);
    expect(rows).toHaveLength(2);
  });

  it("otro dueño con la misma dirección nunca reutiliza el borrador ajeno", async () => {
    const rows: Row[] = [];
    await send(rows, "u1", "100 NE 1st Ave", "33132", t0);
    await send(rows, "u2", "100 NE 1st Ave", "33132", later(1_000));
    expect(rows.map((r) => r.owner_id)).toEqual(["u1", "u2"]);
  });

  it("si la lectura falla, se crea uno nuevo como siempre", async () => {
    const broken = { from: () => { throw new Error("network"); } } as unknown as SupabaseClient;
    expect(await duplicateDraftId(broken, "u1", { street: "100 NE 1st Ave", zip: "33132" }, t0)).toBeNull();
  });

  it("normaliza mayúsculas, puntos, abreviaturas y unidad; el ZIP a 5 dígitos", () => {
    expect(normalizedAddressKey("100 N.E. 1st Avenue, Apt 4", "33132-0001")).toBe(normalizedAddressKey("100 ne 1st ave unit 4", "33132"));
    expect(normalizedAddressKey("100 NE 1st Ave", "33132")).not.toBe(normalizedAddressKey("100 NE 1st Ave", "33131"));
    expect(normalizedAddressKey("100 NE 1st Ave", "33132")).not.toBe(normalizedAddressKey("100 NW 1st Ave", "33132"));
  });

  it("saveStep1 usa la regla, el botón se desactiva al enviar y Enter en una sugerencia no envía", () => {
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page).toContain("const existingId = id || (await duplicateDraftId(supabase, user.id, { street, zip }));");
    expect(page).toContain("<PendingSubmitButton>{copy.nextLabel} →</PendingSubmitButton>");
    expect(readFileSync("src/components/pending-submit-button.tsx", "utf8")).toContain("disabled={pending}");
    expect(readFileSync("src/components/address-autocomplete.tsx", "utf8")).toContain(
      'if (e.key === "Enter" && suggestionsOpen()) e.preventDefault();',
    );
  });
});

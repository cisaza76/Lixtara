import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyListingApprovedOnce,
  writeListingStatus,
  type ApprovedEmailDeps,
} from "./listing-approval.server";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Base mínima: una fila de properties y el historial que escribe el trigger en cada cambio
 * de mls_status. Soporta las dos escrituras de aprobación: la del inicio del admin
 * (`.eq("mls_status", "pending_approval")`) y la de la revisión (`.neq("mls_status", "active")`).
 */
function fakeDb(initial: string) {
  const row = { id: "p1", mls_status: initial, mls_number: null as string | null };
  const history: string[] = [];
  const client = {
    from(table: string) {
      if (table !== "properties") throw new Error(table);
      let values: Partial<typeof row> = {};
      const filters: Array<(r: typeof row) => boolean> = [];
      const apply = () => {
        if (!filters.every((f) => f(row))) return [];
        if (values.mls_status && values.mls_status !== row.mls_status) history.push(values.mls_status);
        Object.assign(row, values);
        return [{ id: row.id }];
      };
      const q = {
        update(v: Partial<typeof row>) {
          values = v;
          return q;
        },
        eq(col: keyof typeof row, val: string) {
          filters.push((r) => r[col] === val);
          return q;
        },
        neq(col: keyof typeof row, val: string) {
          filters.push((r) => r[col] !== val);
          return q;
        },
        select() {
          return Promise.resolve({ data: apply(), error: null });
        },
        then(resolve: (v: { error: null }) => void) {
          apply();
          resolve({ error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const deps = (send: ApprovedEmailDeps["send"]): ApprovedEmailDeps => ({
    countActivations: async () => history.filter((s) => s === "active").length,
    loadListing: async () => ({ ownerId: "u1", address: "1 Main St, Doral, FL 33172" }),
    sellerEmail: async () => "seller@example.com",
    sellerLang: async () => "es",
    send,
  });
  return { client, row, history, deps };
}

/** Lo que hace el inicio del admin: escritura condicional a pending_approval y, si hubo fila, el correo. */
async function approveFromHome(db: ReturnType<typeof fakeDb>, send: ApprovedEmailDeps["send"]) {
  const { data } = await db.client
    .from("properties")
    .update({ mls_status: "active" })
    .eq("id", "p1")
    .eq("mls_status", "pending_approval")
    .select("id");
  if ((data ?? []).length > 0) await notifyListingApprovedOnce("p1", db.deps(send));
}

/** Lo que hace la revisión del listing. */
async function approveFromReview(db: ReturnType<typeof fakeDb>, send: ApprovedEmailDeps["send"], mls: string | null = null) {
  const { becameActive } = await writeListingStatus(db.client, "p1", "active", mls);
  if (becameActive) await notifyListingApprovedOnce("p1", db.deps(send));
}

describe("correo de aprobación: una sola vez por listing", () => {
  it("aprobar desde la revisión lo manda (mismo correo que el inicio)", async () => {
    const db = fakeDb("pending_approval");
    const send = vi.fn(async () => ({}));
    await approveFromReview(db, send as never);
    expect(db.row.mls_status).toBe("active");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "seller@example.com", lang: "es", listingUrl: expect.stringMatching(/\/es\/property\/p1$/) }),
    );
  });

  it("aprobar desde el inicio del admin lo manda", async () => {
    const db = fakeDb("pending_approval");
    const send = vi.fn(async () => ({}));
    await approveFromHome(db, send as never);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("una segunda aprobación (reintento o el otro camino) no lo reenvía", async () => {
    for (const [first, second] of [
      [approveFromHome, approveFromReview],
      [approveFromReview, approveFromHome],
      [approveFromReview, approveFromReview],
      [approveFromHome, approveFromHome],
    ] as const) {
      const db = fakeDb("pending_approval");
      const send = vi.fn(async () => ({}));
      await first(db, send as never);
      await second(db, send as never);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it("reaprobar un listing ya activo con número de MLS guarda el número sin reenviar", async () => {
    const db = fakeDb("pending_approval");
    const send = vi.fn(async () => ({}));
    await approveFromReview(db, send as never);
    await approveFromReview(db, send as never, "A1234567");
    expect(db.row.mls_number).toBe("A1234567");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("si el historial ya tiene una activación anterior (retirado y reactivado), no se reenvía", async () => {
    const send = vi.fn(async () => ({}));
    const deps: ApprovedEmailDeps = {
      countActivations: async () => 2,
      loadListing: async () => ({ ownerId: "u1", address: "x" }),
      sellerEmail: async () => "seller@example.com",
      sellerLang: async () => null,
      send: send as never,
    };
    expect(await notifyListingApprovedOnce("p1", deps)).toBe("already_sent");
    expect(send).not.toHaveBeenCalled();
  });

  it("nunca lanza: un fallo del correo no deshace la aprobación", async () => {
    const deps: ApprovedEmailDeps = {
      countActivations: async () => 1,
      loadListing: async () => ({ ownerId: "u1", address: "x" }),
      sellerEmail: async () => "seller@example.com",
      sellerLang: async () => null,
      send: (async () => {
        throw new Error("resend down");
      }) as never,
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifyListingApprovedOnce("p1", deps)).toBe("failed");
  });
});

describe("los dos caminos de aprobación usan la misma función", () => {
  it("inicio del admin: escritura condicional a pending_approval y notifyListingApprovedOnce", () => {
    const src = read("src/app/[lang]/admin/page.tsx");
    expect(src).toContain('.eq("mls_status", "pending_approval")');
    expect(src).toContain("notifyListingApprovedOnce(prop.id)");
    expect(src).not.toContain("sendListingApproved");
  });

  it("revisión del listing: writeListingStatus y el correo solo si esta llamada lo activó", () => {
    const src = read("src/app/[lang]/admin/listings/[id]/review/page.tsx");
    expect(src).toContain("writeListingStatus(supabase, id, newStatus, mlsNumber)");
    expect(src).toContain("if (becameActive) await notifyListingApprovedOnce(id)");
  });
});

// Cola de aprobación del admin: el vendedor (nombre, correo, teléfono) y un ID corto del
// listing. public.users solo deja leer la fila propia, así que con la sesión del admin la
// columna salía "—": se lee con la clave de servicio tras comprobar el rol.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sellerContactFromRow, shortListingId } from "@/lib/admin-sellers";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { message: string },
  authEmail: {} as Record<string, string>,
  inIds: [] as string[],
}));
vi.mock("@/lib/supabase/service", () => ({
  createService: () => ({
    from: () => ({
      select: () => ({
        in: async (_c: string, ids: string[]) => {
          h.inIds = ids;
          return { data: h.error ? null : h.rows, error: h.error };
        },
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: h.authEmail[id] ? { email: h.authEmail[id] } : null } }),
      },
    },
  }),
}));

import { fetchSellerContacts } from "@/lib/admin-sellers.server";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("sellerContactFromRow / shortListingId", () => {
  it("nombre completo, correo y teléfono; vacíos → null", () => {
    expect(
      sellerContactFromRow({ id: "u", first_name: "Ana", last_name: "Pérez", email: "a@x.com", phone: "+1 305 555 0101" }),
    ).toEqual({ name: "Ana Pérez", email: "a@x.com", phone: "+1 305 555 0101" });
    expect(sellerContactFromRow({ id: "u", first_name: "", last_name: null, email: " ", phone: "" })).toEqual({
      name: null,
      email: null,
      phone: null,
    });
  });

  it("ID corto: 8 caracteres en mayúsculas, distinto para dos listings con la misma dirección", () => {
    expect(shortListingId("3f2a9c1e-77b0-4c1d-9e2f-0a1b2c3d4e5f")).toBe("3F2A9C1E");
    expect(shortListingId("3f2a9c1e-77b0-4c1d-9e2f-0a1b2c3d4e5f")).not.toBe(shortListingId("8b1d0e44-77b0-4c1d-9e2f-0a1b2c3d4e5f"));
  });
});

describe("fetchSellerContacts (clave de servicio simulada)", () => {
  beforeEach(() => {
    h.rows = [];
    h.error = null;
    h.authEmail = {};
    h.inIds = [];
  });

  it("lee nombre, correo y teléfono de public.users, sin ids repetidos", async () => {
    h.rows = [{ id: "u1", first_name: "Ana", last_name: "Pérez", email: "a@x.com", phone: "305-555-0101" }];
    const m = await fetchSellerContacts(["u1", "u1"]);
    expect(h.inIds).toEqual(["u1"]);
    expect(m.get("u1")).toEqual({ name: "Ana Pérez", email: "a@x.com", phone: "305-555-0101" });
  });

  it("sin fila o sin correo en public.users → el correo de la cuenta (Auth)", async () => {
    h.rows = [{ id: "u1", first_name: "Ana", last_name: null, email: null, phone: null }];
    h.authEmail = { u1: "ana@auth.com", u2: "bob@auth.com" };
    const m = await fetchSellerContacts(["u1", "u2"]);
    expect(m.get("u1")).toEqual({ name: "Ana", email: "ana@auth.com", phone: null });
    expect(m.get("u2")).toEqual({ name: null, email: "bob@auth.com", phone: null });
  });

  it("si la lectura falla → mapa vacío (la cola muestra —)", async () => {
    h.error = { message: "boom" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await fetchSellerContacts(["u1"])).size).toBe(0);
    err.mockRestore();
  });
});

describe("la cola del admin", () => {
  const page = src("src/app/[lang]/admin/page.tsx");
  it("comprueba el rol y lee los vendedores con fetchSellerContacts, no con la sesión", () => {
    expect(page).toMatch(/await assertStaffWithUser\(lang\);\s*const sellers = await fetchSellerContacts\(/);
    expect(page).not.toMatch(/\.from\("users"\)/);
  });
  it("muestra el ID corto, el correo y el teléfono", () => {
    expect(page).toContain("shortListingId(p.id)");
    expect(page).toContain("seller.email");
    expect(page).toContain("seller.phone");
  });
});

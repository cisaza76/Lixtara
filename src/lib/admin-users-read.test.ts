// Páginas del admin que muestran a vendedores o compradores: public.users solo deja leer la
// fila propia (users_select_own), así que con la sesión del admin salía "—". Todas leen con
// la clave de servicio, después de comprobar el rol (#212).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { submittedAtByProperty } from "./admin-submitted";

const ADMIN = "src/app/[lang]/admin";
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pages(p) : n === "page.tsx" ? [p] : [];
  });
}

describe("admin: lectura de users", () => {
  it("ninguna página lee users con la sesión", () => {
    for (const p of pages(ADMIN)) {
      expect(readFileSync(p, "utf8"), p).not.toMatch(/supabase\s*\n?\s*\.from\("users"\)/);
    }
  });

  it.each(["transactions", "consultations", "photography", "referrals", "users"])("%s: rol comprobado antes de la clave de servicio", (name) => {
    const src = readFileSync(`${ADMIN}/${name}/page.tsx`, "utf8");
    const check = src.indexOf("await assertStaffWithUser(lang)");
    const read = src.search(/createService\(\)|fetchSellerContacts\(/);
    expect(check, name).toBeGreaterThan(0);
    expect(read, name).toBeGreaterThan(check);
    expect(src, name).not.toContain("function serviceClient()");
  });

  it("transacciones muestra vendedor y comprador", () => {
    const src = readFileSync(`${ADMIN}/transactions/page.tsx`, "utf8");
    expect(src).toContain("contactLine(t.seller_id)");
    expect(src).toContain("contactLine(t.buyer_id)");
  });
});

describe("admin: fecha de envío", () => {
  it("la última entrada en pending_approval, no la última edición", () => {
    const m = submittedAtByProperty([
      { property_id: "a", new_status: "pending_approval", changed_at: "2026-10-01T10:00:00Z" },
      { property_id: "a", new_status: "draft", changed_at: "2026-10-02T10:00:00Z" },
      { property_id: "a", new_status: "pending_approval", changed_at: "2026-10-03T10:00:00Z" },
      { property_id: "b", new_status: "active", changed_at: "2026-10-04T10:00:00Z" },
    ]);
    expect(m.get("a")).toBe("2026-10-03T10:00:00Z");
    expect(m.has("b")).toBe(false);
  });

  it("la página usa esa fecha, sin caer en updated_at", () => {
    const src = readFileSync(`${ADMIN}/page.tsx`, "utf8");
    expect(src).toContain("const submitted = submittedAt.get(p.id) ?? null;");
    expect(src).not.toContain("p.updated_at ?? p.created_at");
  });
});

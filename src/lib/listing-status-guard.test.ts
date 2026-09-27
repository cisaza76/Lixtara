import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Un vendedor no puede aprobar su propio listing. La garantía real es el trigger
// `guard_properties_mls_status` (migración 20260927120000), verificado contra Postgres con
// `pnpm db-check:mls-status-guard` (Docker). Estos tests la anclan en CI, que no corre
// Docker: si alguien afloja el SQL, o escribe mls_status desde código del vendedor —que
// en producción fallaría con 42501—, rompe aquí primero.
const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

describe("migración 20260927120000 — guard de mls_status", () => {
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260927120000_guard_properties_mls_status.sql"), "utf8");
  const cuerpo = sql.slice(sql.indexOf("create or replace function public.guard_properties_mls_status"));

  it("aplica a los roles de la API que no son admin/broker", () => {
    expect(cuerpo).toContain("current_user in ('authenticated', 'anon') and not public.is_admin_or_broker()");
  });

  it("INSERT solo como draft; UPDATE no puede cambiar el estado ni las fechas de publicación", () => {
    expect(cuerpo).toContain("new.mls_status is distinct from 'draft'");
    for (const col of ["mls_status", "mls_published_at", "mls_expires_at"]) {
      expect(cuerpo).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(sql).toContain(
      "before insert or update of mls_status, mls_published_at, mls_expires_at on public.properties");
  });

  it("no es security definer: current_user debe ser el rol de la petición", () => {
    expect(cuerpo.slice(0, cuerpo.indexOf("as $$"))).not.toMatch(/security definer/i);
  });
});

describe("mls_status solo lo escribe quien debe", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  }

  // Módulos autorizados a CAMBIAR mls_status (no a insertarlo como draft):
  const PERMITIDOS = [
    "app/api/webhooks/stripe/route.ts",               // service_role: draft → pending_approval
    "app/[lang]/admin/page.tsx",                      // broker/admin: aprobación rápida
    "app/[lang]/admin/listings/[id]/review/page.tsx", // broker/admin: aprobar/rechazar/cambios
  ];

  const escritores = walk(SRC)
    .map((f) => relative(SRC, f))
    .filter((rel) => !rel.startsWith("lib/mls/")) // mls_listings.mls_status es otra tabla
    .filter((rel) => /\.update\(\s*\{[^}]*\bmls_status\s*:/.test(readFileSync(join(SRC, rel), "utf8")));

  it("el detector ve los escritores conocidos (no pasa en vacío)", () => {
    expect([...escritores].sort()).toEqual(expect.arrayContaining(PERMITIDOS));
  });

  it("ningún otro módulo hace update de mls_status", () => {
    expect(escritores.filter((rel) => !PERMITIDOS.includes(rel))).toEqual([]);
  });

  it("el asistente del vendedor solo inserta borradores", () => {
    const wizard = readFileSync(join(SRC, "app/[lang]/listing/new/page.tsx"), "utf8");
    const valores = [...wizard.matchAll(/mls_status:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(valores).toEqual(["draft"]);
  });
});

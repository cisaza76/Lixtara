import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// La oferta al agente del comprador no se lee con la clave pública (migración 20261017150000,
// sección 5): anon y authenticated tienen SELECT por columna sobre `properties`, sin las cuatro
// columnas de la oferta. La garantía real se verifica contra Postgres con
// `pnpm db-check:buyer-comp` (Docker); estos tests la anclan en CI.
const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const COLUMN_GRANTS_VERSION = "20261017150000";
const OFFER_COLUMNS = [
  "buyer_agent_commission",
  "buyer_agent_comp_type",
  "buyer_agent_comp_amount",
  "buyer_agent_comp_terms_version",
];

const migration = readFileSync(join(MIGRATIONS, `${COLUMN_GRANTS_VERSION}_buyer_agent_comp_offer.sql`), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("lectura de la oferta: solo dueño, admin y broker", () => {
  it("la migración quita el SELECT de tabla y da el de columna sin la oferta", () => {
    expect(migration).toContain("revoke select on public.properties from anon, authenticated;");
    expect(migration).toMatch(/grant select \(%s\) on public\.properties to anon, authenticated/);
    for (const col of OFFER_COLUMNS) expect(migration).toContain(`'${col}'`);
    expect(migration).toMatch(/function public\.get_property_buyer_comp\(p_property_id uuid\)[\s\S]*security definer/);
    expect(migration).toContain("p.owner_id = auth.uid() or public.is_admin_or_broker()");
    expect(migration).toContain("revoke execute on function public.get_property_buyer_comp(uuid) from public, anon;");
  });

  // Con sesión (authenticated) siempre; anon solo si una página pública la lee (20261021120000:
  // financing_terms y financing_other, solo authenticated).
  it("toda columna nueva de properties en una migración posterior lleva su grant select", () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > COLUMN_GRANTS_VERSION)
      .sort();
    const missing: string[] = [];
    for (const f of later) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8").toLowerCase();
      for (const stmt of sql.matchAll(/alter table (?:only )?(?:public\.)?properties\b([^;]*);/g)) {
        for (const m of stmt[1].matchAll(/add column (?:if not exists )?"?([a-z_][a-z0-9_]*)"?/g)) {
          const col = m[1];
          if (OFFER_COLUMNS.includes(col)) continue;
          const granted = new RegExp(
            `grant select \\([^)]*\\b${col}\\b[^)]*\\) on (?:table )?(?:public\\.)?properties to (?:anon, )?authenticated`,
          ).test(sql);
          if (!granted) missing.push(`${f}: ${col}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("el código con la sesión del usuario no pide la oferta a properties: usa fetchBuyerComp", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))) {
      const src = readFileSync(file, "utf8");
      // Con el secret key (service_role) la tabla se lee entera; la sesión del usuario, no.
      if (!/@\/lib\/supabase\/(server|client)"/.test(src)) continue;
      for (const m of src.matchAll(/from\("properties"\)\s*\.select\(\s*(["`])([\s\S]*?)\1/g)) {
        const cols = m[2];
        const hit = OFFER_COLUMNS.find((c) => new RegExp(`\\b${c}\\b`).test(cols));
        if (hit || /^\s*\*\s*$/.test(cols)) offenders.push(`${relative(ROOT, file)}: ${hit ?? "*"}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("los tres lectores leen la oferta con la función", () => {
    for (const f of [
      "src/app/[lang]/listing/new/page.tsx",
      "src/app/[lang]/admin/listings/[id]/review/page.tsx",
      "src/app/api/agreement/create/route.ts",
    ]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toContain("fetchBuyerComp(supabase");
    }
    expect(readFileSync(join(ROOT, "src/lib/buyer-comp.server.ts"), "utf8")).toContain('rpc("get_property_buyer_comp"');
  });

  it("la ficha pública no pide ninguna columna de la oferta", () => {
    const src = readFileSync(join(ROOT, "src/lib/properties.ts"), "utf8");
    for (const col of OFFER_COLUMNS) expect(src).not.toContain(col);
  });
});

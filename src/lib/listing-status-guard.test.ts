import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Un vendedor solo escribe los datos de SU listing: nunca su estado, su tier ya pagado, su
// mls_number ni su marca de prueba. La garantía real son los triggers y políticas de la
// migración 20260927120000, verificados contra Postgres con `pnpm db-check:mls-status-guard`
// (Docker, 41 casos). Estos tests los anclan en CI, que no corre Docker.
const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const sql = readFileSync(
  join(ROOT, "supabase/migrations/20260927120000_guard_properties_mls_status.sql"), "utf8");
const wizard = readFileSync(join(SRC, "app/[lang]/listing/new/page.tsx"), "utf8");

/** Cuerpo de una función de la migración, desde su `create` hasta el siguiente `$$;`. */
function fn(name: string): string {
  const i = sql.indexOf(`create or replace function public.${name}`);
  expect(i, `falta la función ${name}`).toBeGreaterThanOrEqual(0);
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)) + 3);
}

/** Columnas de la lista de permitidas, tal como las declara la migración. */
const permitidas = (() => {
  const cuerpo = fn("properties_seller_writable_columns");
  return [...cuerpo.slice(cuerpo.indexOf("array[")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();

/** Columnas que escribe el asistente del vendedor (literales y asignaciones dinámicas). */
const columnasDelAsistente = (() => {
  const cols = new Set<string>();
  for (const m of wizard.matchAll(/from\("properties"\)\s*\.(?:update|insert)\(\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/(\w+)\s*:/g)) cols.add(k[1]);
  }
  for (const m of wizard.matchAll(/\b(?:updates?|addressUpdate)\.(\w+)\s*=/g)) cols.add(m[1]);
  for (const m of wizard.matchAll(/const (?:addressUpdate|update)\s*(?::[^=]*)?=\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/(\w+)\s*:/g)) cols.add(k[1]);
  }
  return cols;
})();

describe("lista de columnas que el vendedor puede escribir", () => {
  it("cubre TODO lo que escribe el asistente (si no, el guard rompería el flujo del vendedor)", () => {
    // Columnas que el asistente escribe solo en el INSERT inicial o por reglas aparte.
    const aparte = new Set(["owner_id", "mls_status", "pricing_tier"]);
    expect(columnasDelAsistente.size).toBeGreaterThan(20); // el extractor no pasa en vacío
    const faltan = [...columnasDelAsistente].filter((c) => !aparte.has(c) && !permitidas.includes(c));
    expect(faltan, `añadir a properties_seller_writable_columns() o dejar de escribirlas`).toEqual([]);
  });

  it("NO incluye ninguna columna de estado, pago, identidad ni prueba", () => {
    for (const c of ["id", "owner_id", "mls_status", "mls_number", "mls_published_at",
                     "mls_expires_at", "pricing_tier", "is_test", "created_at", "updated_at"]) {
      expect(permitidas, c).not.toContain(c);
    }
  });

  it("pricing_tier solo mientras el listing es borrador", () => {
    expect(fn("guard_properties_seller_columns"))
      .toContain("not (n.key = 'pricing_tier' and old.mls_status = 'draft')");
  });
});

describe("guard_properties_seller_columns", () => {
  const g = fn("guard_properties_seller_columns");

  it("es SECURITY DEFINER con search_path fijo y lee el rol de la PETICIÓN", () => {
    expect(g).toMatch(/security definer\s+set search_path = public, pg_temp/);
    // Dentro de un definer current_user es el dueño: el rol real sale del GUC `role`.
    expect(g).toContain("current_setting('role', true)");
    expect(g).not.toMatch(/\bcurrent_user\b/);
  });

  it("el INSERT del vendedor solo crea borradores sin datos de MLS ni publicación", () => {
    expect(g).toContain("new.mls_status is distinct from 'draft'");
    expect(g).toContain("new.mls_number is not null");
    expect(g).toContain("new.mls_published_at is not null");
  });

  it("is_test solo lo cambia un admin (no un broker)", () => {
    expect(g).toContain("v_admin := public.has_role('admin')");
    expect(g.indexOf("Only an admin can change properties.is_test"))
      .toBeLessThan(g.indexOf("if v_staff then"));
  });

  it("dispara en todo INSERT y UPDATE, no solo en algunas columnas", () => {
    expect(sql).toContain("before insert or update on public.properties\n  for each row execute function public.guard_properties_seller_columns()");
  });
});

describe("historial de estado", () => {
  it("registra estado y fechas de publicación, con quién lo hizo", () => {
    const l = fn("log_property_status_change");
    expect(l).toMatch(/security definer\s+set search_path = public, pg_temp/);
    expect(l).toContain("coalesce(auth.uid()::text, v_role)");
    expect(sql).toContain("after insert or update of mls_status, mls_published_at, mls_expires_at on public.properties");
  });

  it("solo inserciones: la API no puede escribir, editar ni borrar", () => {
    expect(sql).toContain(
      "revoke insert, update, delete, truncate on public.property_status_history from public, anon, authenticated;");
    expect(sql).not.toMatch(/create policy[^;]*property_status_history[^;]*for (insert|update|delete|all)/i);
  });
});

describe("lectura pública, pagos y acuerdos", () => {
  it("las dos políticas públicas de properties excluyen is_test", () => {
    expect(sql.match(/using \(mls_status = 'active' and not is_test\)/g)).toHaveLength(2);
  });

  it("la sesión solo inserta pagos pendientes y acuerdos sin firmar, sobre listings propios", () => {
    expect(sql).toMatch(/"own payments insert"[\s\S]*?status = 'pending'[\s\S]*?completed_at is null[\s\S]*?p\.owner_id = auth\.uid\(\)/);
    expect(sql).toMatch(/"own agreements insert"[\s\S]*?status in \('pending', 'sent'\)[\s\S]*?signed_at is null[\s\S]*?p\.owner_id = auth\.uid\(\)/);
  });

  it("las lecturas públicas del código filtran is_test", () => {
    const props = readFileSync(join(SRC, "lib/properties.ts"), "utf8");
    const activos = props.match(/\.eq\("mls_status", "active"\)/g) ?? [];
    const conFiltro = props.match(/\.eq\("mls_status", "active"\)\s*\.eq\("is_test", false\)/g) ?? [];
    expect(activos.length).toBeGreaterThan(0);
    expect(conFiltro.length).toBe(activos.length);
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
    // Cualquier `mls_status:` dentro de los argumentos de un `.update(…)` —objeto literal,
    // ternario o varias líneas— antes del primer `.eq(` que lo cierra.
    .filter((rel) => /\.update\((?:(?!\.eq\()[\s\S]){0,400}?\bmls_status\s*:/.test(readFileSync(join(SRC, rel), "utf8")));

  it("el detector ve los escritores conocidos (no pasa en vacío)", () => {
    expect([...escritores].sort()).toEqual(expect.arrayContaining(PERMITIDOS));
  });

  it("ningún otro módulo hace update de mls_status", () => {
    expect(escritores.filter((rel) => !PERMITIDOS.includes(rel))).toEqual([]);
  });

  it("el asistente del vendedor solo inserta borradores", () => {
    const valores = [...wizard.matchAll(/mls_status:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(valores).toEqual(["draft"]);
  });
});

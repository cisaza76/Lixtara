// #220: la migración del titular y el segundo firmante, verificada en CI contra un Postgres en
// memoria (PGlite, scripts/db-checks/listing-signers.mjs): RLS, guard, checks, la política de
// inserción de agreements, reversión y re-aplicación. Nunca toca producción.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/20261028120000_listing_signers.sql"), "utf8");
const rollback = readFileSync(join(root, "scripts/sql/rollback_20261028120000_listing_signers.sql"), "utf8");

describe("20261028120000_listing_signers", () => {
  it("pasa todos los casos de la réplica (PGlite), incluida la reversión", () => {
    const out = execFileSync(process.execPath, [join(root, "scripts/db-checks/listing-signers.mjs")], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(out).toMatch(/listing-signers: \d+ casos OK/);
  }, 90_000);

  it("los datos del tercero no quedan en properties ni con lectura pública", () => {
    expect(migration).not.toMatch(/alter table public\.properties/i);
    expect(migration).toContain("revoke all on public.listing_additional_signers from public, anon, authenticated;");
    expect(migration).not.toMatch(/grant [a-z, ]+ on public\.listing_(ownership|additional_signers) to [a-z, ]*anon/i);
  });

  it("no está marcada como aplicada y nombra su reversión", () => {
    expect(migration).toContain("NO APLICADA");
    expect(migration).toContain("scripts/sql/rollback_20261028120000_listing_signers.sql");
  });

  it("la reversión devuelve la política de inserción de 20261021120000", () => {
    const prev = readFileSync(join(root, "supabase/migrations/20261021120000_financing_terms_agreement_legal_status.sql"), "utf8");
    const policy = (s: string) =>
      s.slice(s.lastIndexOf('create policy "own agreements insert"'), s.indexOf(");", s.lastIndexOf('create policy "own agreements insert"')) + 2)
        .replace(/\s+/g, " ");
    expect(policy(rollback)).toBe(policy(prev));
  });
});

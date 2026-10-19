import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildCleanupPlan, confirmationPhrase, isTestEmail, PROPERTY_DEPENDENTS, USER_DEPENDENTS } from "./test-data";

describe("limpieza de datos de prueba", () => {
  it.each([
    ["camilo+lxtest1@gmail.com", true],
    ["someone+smtptest@lixtara.com", true],
    ["qa-lang-1760000000@lixtara.com", true],
    ["QA@lixtara.com", true],
    ["camilo+qa@gmail.com", true],
    ["qatest@example.com", true],
    ["aqaba@example.com", false],
    ["sequoia@example.com", false],
    ["seller@example.com", false],
    [null, false],
  ] as const)("%s → %s", (email, want) => {
    expect(isTestEmail(email)).toBe(want);
  });

  it("una cuenta de prueba con un listing real no se borra: queda para revisar", () => {
    const plan = buildCleanupPlan(
      [
        { id: "u1", email: "qa1@lixtara.com" },
        { id: "u2", email: "qa2@lixtara.com" },
        { id: "u3", email: "real@example.com" },
      ],
      [
        { id: "p1", owner_id: "u1", is_test: false }, // real de una cuenta "QA": no se toca
        { id: "p2", owner_id: "u2", is_test: false }, // de una cuenta que se borra: se borra
        { id: "p3", owner_id: "u3", is_test: true }, // is_test de una cuenta real: se borra el listing, no la cuenta
        { id: "p4", owner_id: "u3", is_test: false }, // real: no se toca
      ],
    );
    // u2 tampoco se borra: su listing no está marcado is_test, así que también es "real".
    expect(plan.accounts.map((a) => a.id)).toEqual([]);
    expect(plan.accountsToReview.map((a) => a.id)).toEqual(["u1", "u2"]);
    expect(plan.properties.map((p) => p.id)).toEqual(["p3"]);
  });

  it("una cuenta de prueba solo con listings is_test se borra con ellos", () => {
    const plan = buildCleanupPlan(
      [{ id: "u1", email: "x+lxtest@gmail.com" }],
      [
        { id: "p1", owner_id: "u1", is_test: true },
        { id: "p2", owner_id: null, is_test: true },
      ],
    );
    expect(plan.accounts.map((a) => a.id)).toEqual(["u1"]);
    expect(plan.properties.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(confirmationPhrase(plan)).toBe("BORRAR 2 LISTINGS Y 1 CUENTAS");
  });

  it("cubre cada FK sin cascada a properties y users del baseline", () => {
    const baseline = readFileSync("supabase/migrations/20260520151434_remote_baseline.sql", "utf8");
    const fks = [...baseline.matchAll(/ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT \w+ FOREIGN KEY \((\w+)\) REFERENCES public\.(properties|users)\(id\);/g)];
    expect(fks.length).toBeGreaterThan(0);
    for (const [, table, column, target] of fks) {
      if (table === "properties" && column === "owner_id") continue; // se borra el listing antes que la cuenta
      const list = target === "properties" ? PROPERTY_DEPENDENTS : USER_DEPENDENTS;
      expect(list, `${table}.${column} → ${target}`).toContainEqual({ table, column });
    }
  });

  it("el script es de solo lectura salvo --apply y la frase exacta", () => {
    const src = readFileSync("scripts/cleanup/prelaunch-test-data.ts", "utf8");
    expect(src).toContain('process.argv.includes("--apply")');
    expect(src).toContain("confirmationPhrase(plan)");
    expect(src.indexOf("if (!APPLY)")).toBeLessThan(src.indexOf(".delete()"));
  });
});

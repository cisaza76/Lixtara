import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { syncIntervalMeetsContract } from "./display-compliance";

// Anclas sobre artefactos que no se pueden ejecutar en los tests (SQL, vercel.json): si
// alguien los cambia, la garantía que documentan tiene que romper un test.
const ROOT = resolve(__dirname, "../../..");
const sql = readFileSync(
  resolve(ROOT, "supabase/migrations/20260926120000_mls_removals_and_reconciliation.sql"), "utf8");

describe("migración 20260926120000 — barrido de la reconciliación", () => {
  const cuerpo = sql.slice(sql.indexOf("function public.mls_reconcile_sweep"));

  it("borra SOLO lo no confirmado Y no tocado por el incremental desde el inicio", () => {
    // Mismo predicado que el fake de reconcile-run.test.ts.
    expect(cuerpo).toMatch(/\(last_confirmed_at is null or last_confirmed_at < p_started_at\)\s+and last_seen_at < p_started_at/);
  });

  it("ninguna función es ejecutable por anon/authenticated", () => {
    for (const f of ["mls_delete_listings(text, text[])", "mls_confirm_listings(text[], timestamptz)",
                     "mls_reconcile_sweep(timestamptz)"]) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f} to service_role;`);
    }
    expect(sql).not.toMatch(/security definer/i);
  });

  it("no toca withdrawn_at ni crea políticas RLS", () => {
    expect(sql).not.toMatch(/alter table[^;]*withdrawn_at/i);
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe("vercel.json — crons del MLS", () => {
  const crons = (JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")).crons ?? []) as
    Array<{ path: string; schedule: string }>;
  const de = (p: string) => crons.find((c) => c.path === p)?.schedule;

  it("la sincronización corre cada 6 h (≤ 24 h del contrato)", () => {
    expect(de("/api/mls/sync")).toBe("23 */6 * * *");
    expect(syncIntervalMeetsContract(6)).toBe(true);
  });

  it("la reconciliación tiene su propia tarea, varias veces en una ventana nocturna", () => {
    // 3:07–5:52 a. m. ET (08–10 UTC): 12 invocaciones; cada una continúa la anterior.
    expect(de("/api/mls/reconcile")).toBe("7,22,37,52 8-10 * * *");
  });
});

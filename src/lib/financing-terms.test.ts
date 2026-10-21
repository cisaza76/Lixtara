// Paso 3: financiación aceptada (Cash, Conventional, VA, FHA, Other con texto). Sin red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FINANCING_OTHER_MAX, FINANCING_TERMS, parseFinancing, savedFinancing } from "./financing-terms";

describe("financiación del paso 3", () => {
  it("una o varias opciones, en orden fijo; cash_only solo con Cash sola", () => {
    expect(parseFinancing(["conventional", "cash"], "")).toEqual({ ok: true, terms: ["cash", "conventional"], other: null, cashOnly: false });
    expect(parseFinancing(["cash"], "")).toEqual({ ok: true, terms: ["cash"], other: null, cashOnly: true });
  });
  it("Other exige texto (hasta 120); sin Other el texto se descarta", () => {
    expect(parseFinancing(["other"], "  Seller   financing ")).toEqual({ ok: true, terms: ["other"], other: "Seller financing", cashOnly: false });
    expect(parseFinancing(["other"], "   ")).toEqual({ ok: false, error: "financing_other_required" });
    expect(parseFinancing(["other"], "x".repeat(FINANCING_OTHER_MAX + 1))).toEqual({ ok: false, error: "financing_other_too_long" });
    expect(parseFinancing(["cash"], "ignored")).toMatchObject({ ok: true, other: null });
  });
  it("sin opción o con valores desconocidos → obligatoria", () => {
    expect(parseFinancing([], "")).toEqual({ ok: false, error: "financing_required" });
    expect(parseFinancing(["crypto"], "")).toEqual({ ok: false, error: "financing_required" });
  });
  it("lo guardado; antes de la migración, desde cash_only", () => {
    expect(savedFinancing({ financing_terms: ["va", "fha"] })).toEqual(["va", "fha"]);
    expect(savedFinancing({ financing_terms: null, cash_only: true })).toEqual(["cash"]);
    expect(savedFinancing({ cash_only: false })).toEqual([]);
  });
  it("los valores son los del CHECK de la migración", () => {
    const mig = readFileSync("supabase/migrations/20261021120000_financing_terms_agreement_legal_status.sql", "utf8");
    expect(mig).toContain(`financing_terms <@ array[${FINANCING_TERMS.map((t) => `'${t}'`).join(", ")}]::text[]`);
    expect(mig).toContain(`length(financing_other) <= ${FINANCING_OTHER_MAX}`);
  });
});

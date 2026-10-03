import { describe, it, expect } from "vitest";
import { MLS_NUMBER_PATTERN, normalizeMlsNumber, parseMlsNumber } from "./listing-mls-number";
import { normalizeMlsNumber as normalizeDelCruce } from "./mls/public-listings";

describe("parseMlsNumber", () => {
  it("acepta los formatos del feed de MIAMI (MIAMI + Beaches)", () => {
    for (const n of ["A11234567", "F10123456", "RX-10123456"]) {
      expect(parseMlsNumber(n), n).toEqual({ ok: true, value: n });
    }
  });

  it("normaliza lo tecleado a mano: espacios y minúsculas", () => {
    expect(parseMlsNumber("  a1123 4567 ")).toEqual({ ok: true, value: "A11234567" });
    expect(parseMlsNumber("rx-10123456")).toEqual({ ok: true, value: "RX-10123456" });
  });

  it("rechaza vacío y formatos imposibles", () => {
    expect(parseMlsNumber("")).toEqual({ ok: false, reason: "empty" });
    expect(parseMlsNumber("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseMlsNumber(null)).toEqual({ ok: false, reason: "empty" });
    for (const n of ["11234567", "ABC1234567", "A12", "A1123456789012", "A1123-4567", "A11234567;drop", "https://x"]) {
      expect(parseMlsNumber(n), n).toEqual({ ok: false, reason: "invalid_format" });
    }
  });

  it("todo lo aceptado ya está normalizado (lo que se guarda es lo que se cruza)", () => {
    expect(MLS_NUMBER_PATTERN.test("a11234567")).toBe(false);
  });

  it("el cruce de /properties usa EXACTAMENTE la misma normalización", () => {
    for (const v of ["a1 123 4567", "RX-10123456", "", null]) {
      expect(normalizeDelCruce(v as string | null)).toBe(normalizeMlsNumber(v as string | null));
    }
  });
});

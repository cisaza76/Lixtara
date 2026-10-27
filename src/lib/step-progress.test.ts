import { describe, it, expect } from "vitest";
import { agreementSignedBySeller, stepState } from "./step-progress";

describe("stepState", () => {
  it("pasos anteriores hechos, actual activo, siguientes pendientes", () => {
    expect([6, 7, 8].map((n) => stepState(n, 7))).toEqual(["done", "active", "upcoming"]);
  });

  it("el paso actual cuenta como hecho cuando ya terminó (acuerdo firmado)", () => {
    expect([6, 7, 8].map((n) => stepState(n, 7, true))).toEqual(["done", "done", "upcoming"]);
  });
});

describe("agreementSignedBySeller", () => {
  it.each([
    ["signed", true],
    ["completed", true],
    ["sent", false],
    ["declined", false],
    [null, false],
  ])("%s → %s", (status, expected) => {
    expect(agreementSignedBySeller(status)).toBe(expected);
  });
});

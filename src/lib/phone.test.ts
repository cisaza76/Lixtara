import { describe, expect, it } from "vitest";
import { formatUsPhone } from "@/lib/phone";

describe("formatUsPhone", () => {
  it("EE. UU. en cualquier forma → +1 (305) 522-3454", () => {
    for (const raw of ["3055223454", "+13055223454", "13055223454", "305-522-3454", "(305) 522-3454", "305.522.3454", " +1 305 522 3454 "]) {
      expect(formatUsPhone(raw)).toBe("+1 (305) 522-3454");
    }
  });
  it("otro país o texto raro → tal como vino, recortado", () => {
    expect(formatUsPhone("+57 300 123 4567")).toBe("+57 300 123 4567");
    expect(formatUsPhone(" ext 12 ")).toBe("ext 12");
    expect(formatUsPhone("305522345")).toBe("305522345");
  });
  it("vacío → ''", () => {
    expect(formatUsPhone(null)).toBe("");
    expect(formatUsPhone(undefined)).toBe("");
    expect(formatUsPhone("  ")).toBe("");
  });
});

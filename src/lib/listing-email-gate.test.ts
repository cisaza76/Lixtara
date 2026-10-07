import { describe, it, expect } from "vitest";
import {
  cleanCodeInput,
  codeHmac,
  generateCode,
  hmacMatches,
  isCodeFormat,
  isValidEmail,
  normalizeEmail,
  resumePath,
} from "@/lib/listing-email-gate";

describe("listing email gate helpers", () => {
  it("normalizes and validates emails", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(isValidEmail("ana@example.com")).toBe(true);
    expect(isValidEmail("ana@example")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(`${"a".repeat(320)}@x.com`)).toBe(false);
  });

  it("generates 6-digit codes, keeping leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(isCodeFormat(generateCode())).toBe(true);
    expect(isCodeFormat("012345")).toBe(true);
    expect(isCodeFormat("12345")).toBe(false);
    expect(isCodeFormat("12a456")).toBe(false);
  });

  it("cleans pasted codes", () => {
    expect(cleanCodeInput(" 123 456 ")).toBe("123456");
    expect(cleanCodeInput("123-456")).toBe("123456");
  });

  it("binds the HMAC to the challenge id and the pepper", () => {
    const h = codeHmac("pepper", "c1", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacMatches(h, codeHmac("pepper", "c1", "123456"))).toBe(true);
    expect(hmacMatches(h, codeHmac("pepper", "c2", "123456"))).toBe(false);
    expect(hmacMatches(h, codeHmac("other", "c1", "123456"))).toBe(false);
    expect(hmacMatches(h, codeHmac("pepper", "c1", "654321"))).toBe(false);
    expect(hmacMatches(h, "")).toBe(false);
  });

  it("refuses to hash without a pepper", () => {
    expect(() => codeHmac("", "c1", "123456")).toThrow(/EMAIL_CODE_PEPPER/);
  });

  it("builds the resume path to the draft's last step", () => {
    expect(resumePath("es", "p1", 5)).toBe("/es/listing/new?id=p1&step=5");
    expect(resumePath("en", "p1", 1)).toBe("/en/listing/new?id=p1&step=2");
    expect(resumePath("en", "p1", null)).toBe("/en/listing/new?id=p1&step=2");
    expect(resumePath("en", null, 4)).toBe("/en/listing/new");
  });
});

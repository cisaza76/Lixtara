import { afterEach, describe, expect, it, vi } from "vitest";
import { emailFrom } from "@/lib/email";

describe("emailFrom", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses EMAIL_FROM when set", () => {
    vi.stubEnv("EMAIL_FROM", "Lixtara <hola@lixtara.com>");
    expect(emailFrom()).toBe("Lixtara <hola@lixtara.com>");
  });

  it("falls back to Resend's test sender when unset or blank", () => {
    vi.stubEnv("EMAIL_FROM", "  ");
    expect(emailFrom()).toBe("Lixtara <onboarding@resend.dev>");
  });
});

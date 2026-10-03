import { describe, it, expect } from "vitest";
import {
  TURNSTILE_RESPONSE_FIELD,
  captchaTokenFrom,
  isCaptchaError,
} from "@/lib/turnstile";

describe("captchaTokenFrom", () => {
  it("reads the token Cloudflare injects into the form", () => {
    const fd = new FormData();
    fd.set(TURNSTILE_RESPONSE_FIELD, "  0.abc-token  ");
    expect(captchaTokenFrom(fd)).toBe("0.abc-token");
  });

  it("returns undefined when the widget is absent or produced no token", () => {
    expect(captchaTokenFrom(new FormData())).toBeUndefined();
    const fd = new FormData();
    fd.set(TURNSTILE_RESPONSE_FIELD, "");
    expect(captchaTokenFrom(fd)).toBeUndefined();
  });
});

describe("isCaptchaError", () => {
  it("recognizes Supabase's captcha_failed code and message", () => {
    expect(isCaptchaError({ code: "captcha_failed", message: "x" })).toBe(true);
    expect(
      isCaptchaError({ message: "captcha protection: request disallowed (no-captcha-response)" }),
    ).toBe(true);
  });

  it("ignores unrelated auth errors", () => {
    expect(isCaptchaError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });
});

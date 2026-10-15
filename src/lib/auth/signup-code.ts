// Shared by /sign-up (sets the cookie) and /auth/verify (reads it, checks the code).

/** httpOnly cookie, scoped to /[lang]/auth/verify, carrying the address just signed up. */
export const SIGNUP_EMAIL_COOKIE = "lx_signup_email";

/** The 6-digit code from the form ("123 456" accepted), or null. */
export function parseSignupCode(value: FormDataEntryValue | null): string | null {
  const code = String(value ?? "").replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

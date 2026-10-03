// Cloudflare Turnstile ↔ Supabase Auth bot protection.
//
// When CAPTCHA protection is enabled in the Supabase dashboard (Auth → Bot and
// Abuse Protection → Turnstile), Supabase Auth itself verifies the token — the
// Turnstile SECRET key lives only in the Supabase dashboard, never in this app.
// Every call to a captcha-protected Auth endpoint must then carry
// `options.captchaToken`, or it fails with `captcha_failed`:
//   signUp · signInAnonymously (POST /signup) · signInWithPassword (/token)
//   resetPasswordForEmail (/recover) · resend (/resend) · signInWithOtp (/otp)
// Not protected (no token needed): verifyOtp (/verify), updateUser (PUT /user),
// session refresh / PKCE exchange, and every admin (secret-key) call.
//
// The widget (src/components/turnstile-widget.tsx) renders inside each auth
// <form> and Cloudflare injects the token into a hidden input named
// TURNSTILE_RESPONSE_FIELD, so server actions read it straight from FormData.
//
// ROLLOUT ORDER: deploy this code first (Supabase ignores the token while
// CAPTCHA is off), THEN enable Turnstile in the Supabase dashboard. The reverse
// order breaks every sign-in, sign-up, password reset and anonymous listing.

export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

/** Public site key. Unset (local dev / CI) → the widget renders nothing. */
export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The Turnstile token posted with an auth form, or undefined when absent. */
export function captchaTokenFrom(formData: FormData): string | undefined {
  const raw = formData.get(TURNSTILE_RESPONSE_FIELD);
  if (typeof raw !== "string") return undefined;
  const token = raw.trim();
  return token.length > 0 ? token : undefined;
}

/** True when Supabase Auth rejected the request for a missing/invalid captcha. */
export function isCaptchaError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "captcha_failed") return true;
  return /captcha/i.test(error.message ?? "");
}

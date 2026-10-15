import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SIGNUP_EMAIL_COOKIE, parseSignupCode } from "@/lib/auth/signup-code";
import { AuthShell, Field, SubmitButton, ErrorBanner } from "@/components/auth-shell";

// After /sign-up. Supabase's "Confirm signup" template sends a 6-digit code
// ({{ .Token }}), not a link, so the seller confirms it here, in the same tab.
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const copy = t(lang).auth.verify;
  // Set by the sign-up action (httpOnly, this path only) so the address never
  // travels in the URL.
  const email = (await cookies()).get(SIGNUP_EMAIL_COOKIE)?.value ?? "";

  const errorMessage =
    sp.error === "format" ? copy.errorFormat : sp.error === "invalid" ? copy.errorInvalid : null;

  async function verifyCode(formData: FormData) {
    "use server";
    const address = String(formData.get("email") ?? "").trim().toLowerCase();
    const token = parseSignupCode(formData.get("code"));
    if (!address || !token) redirect(`/${lang}/auth/verify?error=format`);

    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ email: address, token, type: "signup" });
    if (error) redirect(`/${lang}/auth/verify?error=invalid`);

    (await cookies()).delete({ name: SIGNUP_EMAIL_COOKIE, path: `/${lang}/auth/verify` });
    redirect(`/${lang}`);
  }

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {errorMessage && <ErrorBanner message={errorMessage} />}
      <p className="text-base leading-relaxed text-ink/70">{copy.body}</p>
      <form action={verifyCode} className="flex flex-col gap-6">
        <Field
          label={copy.emailLabel}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email}
        />
        <label className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {copy.codeLabel}
          </span>
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-2xl tracking-[0.4em] text-ink"
          />
        </label>
        <SubmitButton>{copy.submit}</SubmitButton>
      </form>
      <p className="text-xs text-ink/55 leading-relaxed">{copy.noCode}</p>
      <Link
        href={`/${lang}/sign-in`}
        className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
      >
        ← {copy.backToSignIn}
      </Link>
    </AuthShell>
  );
}

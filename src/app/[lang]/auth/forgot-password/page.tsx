import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/config";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { captchaTokenFrom, isCaptchaError } from "@/lib/turnstile";
import {
  AuthShell,
  Field,
  SubmitButton,
  SuccessBanner,
  ErrorBanner,
} from "@/components/auth-shell";

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const copy = t(lang).auth.forgot;
  const sent = sp.sent === "1";

  async function forgotAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const supabase = await createClient();
    // Always proceed silently regardless of whether the email exists —
    // don't leak account existence via response timing or error messages.
    // The one exception is a failed bot check: that says nothing about the
    // account, and the user must retry the challenge.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_URL}/${lang}/auth/reset-password`,
      captchaToken: captchaTokenFrom(formData),
    });
    if (isCaptchaError(error)) {
      redirect(`/${lang}/auth/forgot-password?error=captcha`);
    }
    redirect(`/${lang}/auth/forgot-password?sent=1`);
  }

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {sent ? (
        <>
          <SuccessBanner message={copy.sent} />
          <Link
            href={`/${lang}/sign-in`}
            className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
          >
            ← {copy.backToSignIn}
          </Link>
        </>
      ) : (
        <>
          {sp.error === "captcha" && (
            <ErrorBanner message={t(lang).auth.errors.captchaFailed} />
          )}
          <p className="text-base leading-relaxed text-ink/70">{copy.body}</p>
          <form action={forgotAction} className="flex flex-col gap-6">
            <Field
              label={copy.emailLabel}
              name="email"
              type="email"
              autoComplete="email"
            />
            <TurnstileWidget lang={lang} />
            <SubmitButton>{copy.submit}</SubmitButton>
          </form>
          <Link
            href={`/${lang}/sign-in`}
            className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
          >
            ← {copy.backToSignIn}
          </Link>
        </>
      )}
    </AuthShell>
  );
}

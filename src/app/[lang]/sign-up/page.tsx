import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { returnListingSessionToDraft } from "@/lib/auth/listing-session.server";
import { SITE_URL } from "@/lib/config";
import { SIGNUP_EMAIL_COOKIE } from "@/lib/auth/signup-code";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { captchaTokenFrom, isCaptchaError } from "@/lib/turnstile";
import {
  AuthShell,
  Field,
  SubmitButton,
  ErrorBanner,
} from "@/components/auth-shell";

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await returnListingSessionToDraft(lang);
  const sp = await searchParams;
  const authCopy = t(lang).auth;
  const copy = authCopy.signUp;

  const errorMessage =
    sp.error === "weak_password"
      ? authCopy.errors.passwordTooShort
      : sp.error === "captcha"
        ? authCopy.errors.captchaFailed
        : sp.error === "unexpected"
          ? authCopy.errors.unexpected
          : null;

  async function signUpAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const firstName = String(formData.get("first_name") ?? "").trim();
    const lastName = String(formData.get("last_name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();

    if (password.length < 8) {
      redirect(`/${lang}/sign-up?error=weak_password`);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${SITE_URL}/${lang}/auth/callback?next=/${lang}`,
        captchaToken: captchaTokenFrom(formData),
        // raw_user_meta_data — the handle_new_user trigger reads these to
        // populate the matching columns in public.users.
        data: {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
        },
      },
    });

    if (error) {
      redirect(
        `/${lang}/sign-up?error=${isCaptchaError(error) ? "captcha" : "unexpected"}`,
      );
    }

    // The confirmation email carries a 6-digit code; /auth/verify asks for it
    // with the address prefilled from this cookie (never in the URL).
    (await cookies()).set(SIGNUP_EMAIL_COOKIE, email.toLowerCase(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/${lang}/auth/verify`,
      maxAge: 60 * 60,
    });
    redirect(`/${lang}/auth/verify`);
  }

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {errorMessage && <ErrorBanner message={errorMessage} />}
      <form action={signUpAction} className="flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Field
            label={copy.nameLabel}
            name="first_name"
            type="text"
            autoComplete="given-name"
          />
          <Field
            label={copy.lastNameLabel}
            name="last_name"
            type="text"
            autoComplete="family-name"
          />
        </div>
        <Field
          label={copy.phoneLabel}
          name="phone"
          type="text"
          autoComplete="tel"
          help={copy.phoneHelp}
        />
        <Field
          label={copy.emailLabel}
          name="email"
          type="email"
          autoComplete="email"
        />
        <Field
          label={copy.passwordLabel}
          name="password"
          type="password"
          autoComplete="new-password"
          help={copy.passwordHelp}
        />
        <TurnstileWidget lang={lang} />
        <SubmitButton>{copy.submit}</SubmitButton>
      </form>
      <p className="text-xs text-ink/55 leading-relaxed">{copy.terms}</p>
      <div className="text-sm text-ink/70">
        {copy.haveAccount}{" "}
        <Link
          href={`/${lang}/sign-in`}
          className="text-ink hover:text-gold transition-colors font-medium"
        >
          {copy.signInLink}
        </Link>
      </div>
    </AuthShell>
  );
}

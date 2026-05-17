import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/config";
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
  const sp = await searchParams;
  const authCopy = t(lang).auth;
  const copy = authCopy.signUp;

  const errorMessage =
    sp.error === "weak_password"
      ? authCopy.errors.passwordTooShort
      : sp.error === "unexpected"
        ? authCopy.errors.unexpected
        : null;

  async function signUpAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const firstName = String(formData.get("first_name") ?? "").trim();

    if (password.length < 8) {
      redirect(`/${lang}/sign-up?error=weak_password`);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${SITE_URL}/${lang}/auth/callback?next=/${lang}`,
        data: { first_name: firstName },
      },
    });

    if (error) {
      redirect(`/${lang}/sign-up?error=unexpected`);
    }

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
        <Field
          label={copy.nameLabel}
          name="first_name"
          type="text"
          autoComplete="given-name"
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

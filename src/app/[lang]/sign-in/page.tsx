import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  AuthShell,
  Field,
  SubmitButton,
  ErrorBanner,
} from "@/components/auth-shell";

const ERRORS = ["invalid", "not_confirmed", "unexpected"] as const;
type ErrorKey = (typeof ERRORS)[number];

function isErrorKey(value: string | undefined): value is ErrorKey {
  return value !== undefined && (ERRORS as readonly string[]).includes(value);
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const authCopy = t(lang).auth;
  const copy = authCopy.signIn;

  const errorMessage = isErrorKey(sp.error)
    ? sp.error === "invalid"
      ? authCopy.errors.invalidCredentials
      : sp.error === "not_confirmed"
        ? authCopy.errors.emailNotConfirmed
        : authCopy.errors.unexpected
    : null;

  async function signInAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const next = String(formData.get("next") ?? `/${lang}`);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      let key: ErrorKey = "unexpected";
      if (/invalid login credentials/i.test(error.message)) key = "invalid";
      else if (/email not confirmed/i.test(error.message)) key = "not_confirmed";
      redirect(`/${lang}/sign-in?error=${key}`);
    }

    redirect(next);
  }

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {errorMessage && <ErrorBanner message={errorMessage} />}
      <form action={signInAction} className="flex flex-col gap-6">
        <input type="hidden" name="next" value={sp.next ?? `/${lang}`} />
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
          autoComplete="current-password"
        />
        <SubmitButton>{copy.submit}</SubmitButton>
      </form>
      <div className="flex flex-col gap-3 text-sm text-ink/70">
        <Link
          href={`/${lang}/auth/forgot-password`}
          className="hover:text-gold transition-colors"
        >
          {copy.forgotLink}
        </Link>
        <div>
          {copy.noAccount}{" "}
          <Link
            href={`/${lang}/sign-up`}
            className="text-ink hover:text-gold transition-colors font-medium"
          >
            {copy.signUpLink}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  AuthShell,
  Field,
  SubmitButton,
  ErrorBanner,
  SuccessBanner,
} from "@/components/auth-shell";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const authCopy = t(lang).auth;
  const copy = authCopy.reset;

  const errorMessage =
    sp.error === "mismatch"
      ? copy.mismatch
      : sp.error === "weak"
        ? authCopy.errors.passwordTooShort
        : sp.error === "unexpected"
          ? authCopy.errors.unexpected
          : null;
  const success = sp.success === "1";

  async function resetAction(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (password !== confirm) {
      redirect(`/${lang}/auth/reset-password?error=mismatch`);
    }
    if (password.length < 8) {
      redirect(`/${lang}/auth/reset-password?error=weak`);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      redirect(`/${lang}/auth/reset-password?error=unexpected`);
    }
    redirect(`/${lang}/auth/reset-password?success=1`);
  }

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {success ? (
        <>
          <SuccessBanner message={copy.success} />
          <Link
            href={`/${lang}/sign-in`}
            className="inline-flex items-center justify-center px-10 py-4 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors mt-2"
          >
            {copy.backToSignIn}
          </Link>
        </>
      ) : (
        <>
          {errorMessage && <ErrorBanner message={errorMessage} />}
          <form action={resetAction} className="flex flex-col gap-6">
            <Field
              label={copy.passwordLabel}
              name="password"
              type="password"
              autoComplete="new-password"
            />
            <Field
              label={copy.confirmLabel}
              name="confirm"
              type="password"
              autoComplete="new-password"
            />
            <SubmitButton>{copy.submit}</SubmitButton>
          </form>
        </>
      )}
    </AuthShell>
  );
}

import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { returnListingSessionToDraft } from "@/lib/auth/listing-session.server";
import { SITE_URL } from "@/lib/config";
import { postSignInPath, safeNextPath } from "@/lib/auth/safe-redirect";
import { isStaff } from "@/lib/admin-auth";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { captchaTokenFrom, isCaptchaError } from "@/lib/turnstile";
import { STEP1_FORM_COOKIE, decodeStep1Form, isStep1RestoreNext } from "@/lib/listing-step1-form";
import {
  AuthShell,
  Field,
  SubmitButton,
  ErrorBanner,
} from "@/components/auth-shell";

const ERRORS = ["invalid", "not_confirmed", "captcha", "unexpected"] as const;
type ErrorKey = (typeof ERRORS)[number];

function isErrorKey(value: string | undefined): value is ErrorKey {
  return value !== undefined && (ERRORS as readonly string[]).includes(value);
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; next?: string; other?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  // "Iniciar sesión con otra cuenta" (paso 7): quien elige entrar con otra cuenta no vuelve
  // al borrador; se le avisa que el borrador de este navegador se pierde.
  const otherAccount = sp.other === "1";
  if (!otherAccount) await returnListingSessionToDraft(lang);
  const authCopy = t(lang).auth;
  const copy = authCopy.signIn;
  // Viene del paso 1 ("este correo ya tiene una cuenta"): el correo que escribió ahí.
  const step1Email = isStep1RestoreNext(sp.next)
    ? decodeStep1Form((await cookies()).get(STEP1_FORM_COOKIE)?.value)?.email || undefined
    : undefined;

  const errorMessage = isErrorKey(sp.error)
    ? sp.error === "invalid"
      ? authCopy.errors.invalidCredentials
      : sp.error === "not_confirmed"
        ? authCopy.errors.emailNotConfirmed
        : sp.error === "captcha"
          ? authCopy.errors.captchaFailed
          : authCopy.errors.unexpected
    : null;

  async function signInAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    // `next` originates from the ?next= query param (rendered into a hidden field). Next.js
    // redirect() honors absolute external URLs, so an unvalidated next is an open redirect —
    // resolve it to a same-origin relative path first (same helper the auth callback uses).
    const next = safeNextPath(formData.get("next")?.toString(), SITE_URL, `/${lang}`);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaTokenFrom(formData) },
    });

    if (error) {
      let key: ErrorKey = "unexpected";
      if (/invalid login credentials/i.test(error.message)) key = "invalid";
      else if (/email not confirmed/i.test(error.message)) key = "not_confirmed";
      else if (isCaptchaError(error)) key = "captcha";
      // Un intento fallido no pierde el destino (p. ej. volver al paso 1 con lo escrito).
      const keepNext = next === `/${lang}` ? "" : `&next=${encodeURIComponent(next)}`;
      const keepOther = formData.get("other") === "1" ? "&other=1" : "";
      redirect(`/${lang}/sign-in?error=${key}${keepNext}${keepOther}`);
    }

    redirect(postSignInPath(next, lang, await isStaff(supabase)));
  }

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {errorMessage && <ErrorBanner message={errorMessage} />}
      {otherAccount && (
        <p role="note" className="border border-gold bg-gold/5 px-4 py-3 text-sm text-ink leading-relaxed">
          {copy.otherAccountWarning}
        </p>
      )}
      <form action={signInAction} className="flex flex-col gap-6">
        <input type="hidden" name="next" value={sp.next ?? `/${lang}`} />
        {otherAccount && <input type="hidden" name="other" value="1" />}
        <Field
          label={copy.emailLabel}
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={step1Email}
        />
        <Field
          label={copy.passwordLabel}
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <TurnstileWidget lang={lang} />
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

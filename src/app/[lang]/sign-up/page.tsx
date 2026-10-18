import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { redirectSignedInToPanel, returnListingSessionToDraft } from "@/lib/auth/listing-session.server";
import { SITE_URL } from "@/lib/config";
import { SIGNUP_EMAIL_COOKIE } from "@/lib/auth/signup-code";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { captchaTokenFrom, isCaptchaError } from "@/lib/turnstile";
import { passwordRejection } from "@/lib/auth/password-errors";
import { createService } from "@/lib/supabase/service";
import { CONSENTS, consentCheckbox } from "@/lib/legal/consents";
import { recordAcceptance, termsAcceptedIn } from "@/lib/legal/consents.server";
import { TermsConsentCheckbox } from "@/components/terms-consent-checkbox";
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
  await redirectSignedInToPanel(lang);
  const sp = await searchParams;
  const authCopy = t(lang).auth;
  const copy = authCopy.signUp;

  const errorMessage =
    sp.error === "weak_password"
      ? authCopy.errors.passwordTooShort
      : sp.error === "leaked_password"
      ? authCopy.errors.leakedPassword
      : sp.error === "rejected_password"
      ? authCopy.errors.passwordRejected
      : sp.error === "terms_required"
      ? authCopy.errors.termsRequired
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

    // Aceptación expresa de los Términos y la Privacidad: sin la casilla no se crea la cuenta.
    if (!termsAcceptedIn(formData)) {
      redirect(`/${lang}/sign-up?error=terms_required`);
    }
    if (password.length < 8) {
      redirect(`/${lang}/sign-up?error=weak_password`);
    }

    const supabase = await createClient();
    const { data: signUpData, error } = await supabase.auth.signUp({
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
      const rejected = passwordRejection(error);
      redirect(
        `/${lang}/sign-up?error=${
          rejected === "leaked"
            ? "leaked_password"
            : rejected === "weak"
              ? "rejected_password"
              : isCaptchaError(error)
                ? "captcha"
                : "unexpected"
        }`,
      );
    }

    // Prueba de la aceptación (versión, idioma, hash, IP, user agent, fecha). Con un correo ya
    // registrado Supabase devuelve un usuario sin identidades y no crea nada: no hay qué
    // registrar. Si la prueba no queda guardada, la cuenta nueva se borra: ninguna cuenta
    // existe sin su aceptación.
    const created = signUpData.user;
    if (created && (created.identities?.length ?? 0) > 0) {
      const recorded = await recordAcceptance({
        document: "terms",
        lang: lang === "es" ? "es" : "en",
        context: "signup",
        userId: created.id,
        headers: await headers(),
      });
      if (!recorded) {
        await createService().auth.admin.deleteUser(created.id).catch(() => {});
        redirect(`/${lang}/sign-up?error=unexpected`);
      }
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
        <TermsConsentCheckbox
          lang={lang}
          parts={consentCheckbox("terms", lang)}
          version={CONSENTS.terms.version}
        />
        <TurnstileWidget lang={lang} />
        <SubmitButton>{copy.submit}</SubmitButton>
      </form>
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

import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { isLocale, t } from "@/lib/i18n";
import { AuthShell, Field, SubmitButton, ErrorBanner, SuccessBanner } from "@/components/auth-shell";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { isValidEmail, normalizeEmail } from "@/lib/listing-email-gate";
import { sendResumeLink } from "@/lib/listing-email-gate.server";
import { LocalizedValidation } from "@/components/localized-validation";

// "Continue my listing": a seller who lost their session (closed the tab,
// changed device) asks for a magic link back to their draft. Only emails that
// were verified at step 1 get one, and the answer is the same either way so
// this page can't be used to find out who is selling.
export default async function ContinueListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const copy = t(lang).listingForm.resume;

  async function requestLink(formData: FormData) {
    "use server";
    if (!isLocale(lang)) return;
    const email = normalizeEmail(formData.get("email"));
    if (!isValidEmail(email)) redirect(`/${lang}/listing/continue?error=email`);

    const ip =
      (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const label = "listing:resume";
    const message = "rate_limited";
    const blocked =
      (await enforceLimit(apiLimiter("listing:resume-ip", 10, "1 h"), ip, { label, message })) ??
      (await enforceLimit(apiLimiter("listing:resume-email", 3, "1 h"), email, { label, message }));
    if (blocked) redirect(`/${lang}/listing/continue?error=limit`);

    await sendResumeLink({ email, lang });
    redirect(`/${lang}/listing/continue?sent=1`);
  }

  const error =
    sp.error === "email"
      ? copy.errEmail
      : sp.error === "limit"
        ? copy.errLimit
        : sp.error === "link"
          ? copy.errLink
          : null;

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      {/* Browser validation bubbles in the page's language, not the browser's. */}
      <LocalizedValidation labels={t(lang).listingForm.validation} />
      <p className="text-base leading-relaxed text-ink/70">{copy.body}</p>
      {error && <ErrorBanner message={error} />}
      {sp.sent === "1" ? (
        <SuccessBanner message={copy.sent} />
      ) : (
        <form action={requestLink} className="flex flex-col gap-6">
          <Field
            label={copy.emailLabel}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <SubmitButton>{copy.submit} →</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}

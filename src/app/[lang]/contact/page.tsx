import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { SITE_URL } from "@/lib/config";
import { BROKERAGE } from "@/config/brokerage";
import { CONTACT, telHref, whatsappHref } from "@/config/contact";
import { CONTACT_TOPICS, parseContactForm } from "@/lib/contact-form";
import { sendContactMessage } from "@/lib/email";
import { apiLimiter, enforceLimit } from "@/lib/ratelimit";
import { ContactActions } from "@/components/contact-actions";
import {
  ErrorBanner,
  Field,
  SubmitButton,
  SuccessBanner,
  TextareaField,
} from "@/components/auth-shell";

const ERRORS = ["required", "email", "too_long", "rate_limited", "send_failed"] as const;
type ErrorKey = (typeof ERRORS)[number];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const copy = t(isLocale(lang) ? lang : "en").contactPage;
  return { title: `${copy.eyebrow} | Lixtara` };
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const locale: Locale = lang;
  const sp = await searchParams;
  const copy = t(lang).contactPage;
  const error = (ERRORS as readonly string[]).includes(sp.error ?? "")
    ? copy.errors[sp.error as ErrorKey]
    : null;

  async function sendAction(formData: FormData) {
    "use server";
    const back = `/${lang}/contact`;
    const parsed = parseContactForm((k) => formData.get(k)?.toString());
    // Honeypot hit: pretend it worked so bots learn nothing.
    if (!parsed.ok && parsed.error === "spam") redirect(`${back}?sent=1`);
    if (!parsed.ok) redirect(`${back}?error=${parsed.error}`);

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    const limited = await enforceLimit(apiLimiter("contact", 5, "1 h"), ip, {
      message: "rate_limited",
      label: "contact form",
    });
    if (limited) redirect(`${back}?error=rate_limited`);

    const result = await sendContactMessage({
      to: CONTACT.inboxEmail,
      lang: locale,
      ...parsed.data,
      pageUrl: `${SITE_URL}${back}`,
    });
    if (!result.ok) redirect(`${back}?error=send_failed`);
    redirect(`${back}?sent=1&topic=${parsed.data.topic}`);
  }

  return (
    <main className="bg-background text-foreground flex-1">
      <section className="mx-auto w-full max-w-5xl px-6 lg:px-12 py-20 lg:py-28 grid gap-16 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {copy.eyebrow}
          </p>
          <h1 className="font-display text-5xl md:text-6xl leading-[1.05] tracking-tight text-ink font-normal">
            {copy.titleBefore}
            {copy.titleAccent && <em className="italic text-gold">{copy.titleAccent}</em>}
            {copy.titleAfter}
          </h1>
          <p className="text-lg leading-relaxed text-ink/70">{copy.intro}</p>
          <ContactActions
            lang={lang}
            whatsappHref={whatsappHref(copy.whatsappPrefill)}
            telHref={telHref()}
            whatsappLabel={copy.whatsappCta}
            callLabel={copy.callCta}
            phoneDisplay={CONTACT.phoneDisplay}
          />
          <div className="flex flex-col gap-1 text-sm text-ink/70 border-t border-gold-soft pt-6">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {copy.officeLabel}
            </span>
            <span>{BROKERAGE.legalName}</span>
            <span>{BROKERAGE.address}</span>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="font-display text-3xl text-ink font-normal">{copy.formTitle}</h2>
          {sp.sent === "1" && <SuccessBanner message={copy.sent} />}
          {error && <ErrorBanner message={error} />}
          <form action={sendAction} className="flex flex-col gap-6">
            <Field label={copy.nameLabel} name="name" autoComplete="name" />
            <Field label={copy.emailLabel} name="email" type="email" autoComplete="email" />
            <Field label={copy.phoneLabel} name="phone" required={false} autoComplete="tel" />
            <label className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                {copy.topicLabel}
              </span>
              <select
                name="topic"
                defaultValue="sell"
                className="bg-ivory border-2 border-gold-soft focus:border-gold outline-none px-4 py-3 text-base text-ink"
              >
                {CONTACT_TOPICS.map((topic) => (
                  <option key={topic} value={topic}>
                    {copy.topics[topic]}
                  </option>
                ))}
              </select>
            </label>
            <TextareaField label={copy.messageLabel} name="message" rows={6} />
            {/* Honeypot — hidden from people, filled by bots. */}
            <div aria-hidden className="absolute -left-[9999px] w-px h-px overflow-hidden">
              <label>
                Website
                <input name="website" type="text" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <SubmitButton>{copy.submit}</SubmitButton>
          </form>
        </div>
      </section>
    </main>
  );
}

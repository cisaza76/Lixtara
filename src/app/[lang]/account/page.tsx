import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { Field, SubmitButton, ErrorBanner, SuccessBanner } from "@/components/auth-shell";

// "My account": the signed-in person sees the email they registered with,
// edits their name and phone (the name is the signer on the listing
// agreement), sets or changes their password, manages reminder emails, and
// finds the rest of their tools. Email changes go through support for now:
// the email is tied to signed agreements and payments.

const SUPPORT_EMAIL = "support@lixtara.com";
const PRIVACY_EMAIL = "privacy@lixtara.com";

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const copy = t(lang).account;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) redirect(`/${lang}/sign-in?next=/account`);

  const { data: profileRow } = await supabase
    .from("users")
    .select("first_name, last_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const profile = (profileRow ?? {}) as {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  };

  const { data: leadRow } = await createService()
    .from("seller_leads")
    .select("email_opt_out_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const lead = leadRow as { email_opt_out_at: string | null } | null;

  // Accounts created through the step-1 email code have no password until
  // they set one (here or at the agreement step).
  const hasPassword = user.user_metadata?.account_pending !== true;
  const back = `/${lang}/account`;

  async function saveProfile(formData: FormData) {
    "use server";
    const firstName = String(formData.get("first_name") ?? "").trim().slice(0, 80);
    const lastName = String(formData.get("last_name") ?? "").trim().slice(0, 80);
    const phone = String(formData.get("phone") ?? "").trim().slice(0, 30);
    if (!firstName || !lastName) redirect(`${back}?error=name`);
    if (phone && !/^[+()\d\s.-]{7,30}$/.test(phone)) redirect(`${back}?error=phone`);

    const sb = await createClient();
    const {
      data: { user: me },
    } = await sb.auth.getUser();
    if (!me?.email) redirect(`/${lang}/sign-in?next=/account`);

    const { error } = await sb
      .from("users")
      .upsert(
        { id: me.id, email: me.email, first_name: firstName, last_name: lastName, phone: phone || null },
        { onConflict: "id" },
      );
    if (error) redirect(`${back}?error=failed`);
    await sb.auth.updateUser({ data: { first_name: firstName, last_name: lastName } });
    redirect(`${back}?saved=profile`);
  }

  async function savePassword(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password.length < 8) redirect(`${back}?error=weak#password`);
    if (password !== confirm) redirect(`${back}?error=mismatch#password`);

    const sb = await createClient();
    const {
      data: { user: me },
    } = await sb.auth.getUser();
    if (!me) redirect(`/${lang}/sign-in?next=/account`);

    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      // Supabase may ask for a recent sign-in before a password change.
      const reauth = /reauth|recent|nonce/i.test(error.message);
      redirect(`${back}?error=${reauth ? "reauth" : "failed"}#password`);
    }

    // A step-1 account that now has a name and a password is complete: the
    // agreement step stops asking for them.
    if (me.user_metadata?.account_pending === true) {
      const { data: names } = await sb
        .from("users")
        .select("first_name, last_name")
        .eq("id", me.id)
        .maybeSingle();
      const n = names as { first_name: string | null; last_name: string | null } | null;
      if (n?.first_name && n?.last_name) {
        await createService().auth.admin.updateUserById(me.id, {
          user_metadata: { account_pending: false },
        });
      }
    }
    redirect(`${back}?saved=password#password`);
  }

  async function saveEmailPrefs(formData: FormData) {
    "use server";
    const wantsReminders = formData.get("reminders") === "on";
    const sb = await createClient();
    const {
      data: { user: me },
    } = await sb.auth.getUser();
    if (!me) redirect(`/${lang}/sign-in?next=/account`);
    // seller_leads has no user write policy (server-only by design): write
    // with the secret key, scoped to this user's own row.
    await createService()
      .from("seller_leads")
      .update({ email_opt_out_at: wantsReminders ? null : new Date().toISOString() })
      .eq("user_id", me.id);
    redirect(`${back}?saved=emails#emails`);
  }

  const errors: Record<string, string> = {
    name: copy.errName,
    phone: copy.errPhone,
    weak: copy.errWeak,
    mismatch: copy.errMismatch,
    reauth: copy.errReauth,
    failed: copy.errFailed,
  };
  const saved: Record<string, string> = {
    profile: copy.savedProfile,
    password: copy.savedPassword,
    emails: copy.savedEmails,
  };
  const errorMessage = sp.error ? errors[sp.error] ?? copy.errFailed : null;
  const savedMessage = sp.saved ? saved[sp.saved] ?? null : null;
  const memberSince = new Date(user.created_at).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  const card = "border border-gold-soft bg-ivory-strong/30 p-6 lg:p-8 flex flex-col gap-5";
  const h2 = "font-display text-2xl text-ink font-normal";
  const lead2 = "text-sm text-ink/65 leading-relaxed";

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-3xl px-6 lg:px-12 pt-12 pb-20 lg:pt-16 lg:pb-28 flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {copy.eyebrow}
          </p>
          <h1 className="font-display text-3xl md:text-4xl leading-[1.1] tracking-tight text-ink font-normal">
            {copy.title}
          </h1>
        </div>

        {errorMessage && <ErrorBanner message={errorMessage} />}
        {savedMessage && <SuccessBanner message={savedMessage} />}

        {/* Sign-in email */}
        <div className={card}>
          <h2 className={h2}>{copy.emailTitle}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base text-ink font-medium break-all">{user.email}</span>
            {user.email_confirmed_at && (
              <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold bg-gold/5 text-ink">
                {copy.verified}
              </span>
            )}
          </div>
          <p className={lead2}>
            {copy.memberSince} {memberSince}. {copy.emailChange}{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4 text-gold hover:text-ink">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </div>

        {/* Personal info */}
        <form action={saveProfile} className={card}>
          <div className="flex flex-col gap-2">
            <h2 className={h2}>{copy.profileTitle}</h2>
            <p className={lead2}>{copy.profileBody}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={copy.firstName} name="first_name" required autoComplete="given-name" defaultValue={profile.first_name ?? ""} />
            <Field label={copy.lastName} name="last_name" required autoComplete="family-name" defaultValue={profile.last_name ?? ""} />
          </div>
          <Field label={copy.phone} name="phone" autoComplete="tel" defaultValue={profile.phone ?? ""} help={copy.phoneHelp} />
          <SubmitButton>{copy.save}</SubmitButton>
        </form>

        {/* Password */}
        <form action={savePassword} id="password" className={`${card} scroll-mt-24`}>
          <div className="flex flex-col gap-2">
            <h2 className={h2}>{hasPassword ? copy.passwordTitle : copy.passwordSetTitle}</h2>
            <p className={lead2}>{hasPassword ? copy.passwordBody : copy.passwordSetBody}</p>
          </div>
          <Field label={copy.newPassword} name="password" type="password" required autoComplete="new-password" help={copy.passwordHint} />
          <Field label={copy.confirmPassword} name="confirm" type="password" required autoComplete="new-password" />
          <SubmitButton>{hasPassword ? copy.changePassword : copy.setPassword}</SubmitButton>
        </form>

        {/* Reminder emails (only for sellers who started a listing) */}
        {lead && (
          <form action={saveEmailPrefs} id="emails" className={`${card} scroll-mt-24`}>
            <div className="flex flex-col gap-2">
              <h2 className={h2}>{copy.emailsTitle}</h2>
              <p className={lead2}>{copy.emailsBody}</p>
            </div>
            <label className="flex items-start gap-3 text-sm text-ink/80 cursor-pointer">
              <input
                type="checkbox"
                name="reminders"
                defaultChecked={!lead.email_opt_out_at}
                className="accent-gold w-4 h-4 mt-0.5"
              />
              <span>{copy.remindersLabel}</span>
            </label>
            <SubmitButton>{copy.save}</SubmitButton>
          </form>
        )}

        {/* Tools */}
        <div className={card}>
          <h2 className={h2}>{copy.toolsTitle}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              { href: `/${lang}/dashboard`, label: copy.toolDashboard },
              { href: `/${lang}/listing/new`, label: copy.toolNewListing },
              { href: `/${lang}/dashboard#received-offers`, label: copy.toolOffers },
              { href: `/${lang}/properties`, label: copy.toolBrowse },
              { href: `/${lang}/consultations`, label: copy.toolConsultations },
              { href: `/${lang}/auth/forgot-password`, label: copy.toolForgot },
            ].map((tool) => (
              <li key={tool.href}>
                <Link
                  href={tool.href}
                  className="flex items-center justify-between border border-gold-soft px-4 py-3 text-ink/80 hover:border-gold hover:text-ink transition-colors"
                >
                  {tool.label} <span aria-hidden className="text-gold">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Sign out + privacy */}
        <div className="flex flex-col gap-4 border-t border-gold-soft pt-6">
          <form action={`/${lang}/auth/sign-out`} method="post">
            <button
              type="submit"
              className="text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:text-gold transition-colors"
            >
              {copy.signOut}
            </button>
          </form>
          <p className="text-xs text-ink/55 leading-relaxed">
            {copy.deleteBody}{" "}
            <a
              href={`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(copy.deleteSubject)}`}
              className="underline underline-offset-4 hover:text-gold"
            >
              {PRIVACY_EMAIL}
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}

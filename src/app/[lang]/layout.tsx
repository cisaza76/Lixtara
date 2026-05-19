import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Playfair_Display } from "next/font/google";
import { notFound } from "next/navigation";
import { isLocale, locales, t, type Locale } from "@/lib/i18n";
import {
  BROKERAGE_LICENSED_ENTITY,
  BROKERAGE_LOCATION,
  BROKER_LICENSE,
} from "@/lib/broker";
import { createClient } from "@/lib/supabase/server";
import { LouiWidget } from "@/components/loui-widget";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lixtara — Florida real estate, licensed brokerage",
  description:
    "Sell your Florida home with a licensed brokerage. Full MLS exposure. You keep more equity.",
};

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const navCopy = t(lang).nav;
  const authNavCopy = t(lang).auth.nav;
  const footerCopy = t(lang).footer;
  const louiCopy = t(lang).loui;
  const altLang: Locale = lang === "en" ? "es" : "en";
  const year = new Date().getFullYear();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let firstName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("first_name")
      .eq("id", user.id)
      .maybeSingle();
    firstName = profile?.first_name ?? null;
  }

  return (
    <html
      lang={lang}
      className={`${inter.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-gold-soft">
          <nav className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-6 flex items-center justify-between gap-8">
            <Link
              href={`/${lang}`}
              className="font-display italic text-2xl lg:text-3xl text-ink leading-none"
            >
              Lixtara
            </Link>

            <ul className="hidden md:flex items-center gap-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
              <li>
                <Link
                  href={`/${lang}/properties`}
                  className="hover:text-gold transition-colors"
                >
                  {navCopy.buy}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}/listing/new`}
                  className="hover:text-gold transition-colors"
                >
                  {navCopy.sell}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}#how-it-works`}
                  className="hover:text-gold transition-colors"
                >
                  {navCopy.howItWorks}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}#pricing`}
                  className="hover:text-gold transition-colors"
                >
                  {navCopy.pricing}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${lang}#faq`}
                  className="hover:text-gold transition-colors"
                >
                  {navCopy.faq}
                </Link>
              </li>
            </ul>

            <div className="flex items-center gap-5 lg:gap-7">
              <Link
                href={`/${altLang}`}
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
              >
                {navCopy.langToggle}
              </Link>
              {user ? (
                <div className="flex items-center gap-4 lg:gap-5">
                  {firstName && (
                    <span className="hidden md:inline text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/70">
                      {authNavCopy.greetingPrefix} {firstName}
                    </span>
                  )}
                  <Link
                    href={`/${lang}/dashboard`}
                    className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                  >
                    {authNavCopy.dashboard}
                  </Link>
                  <form action={`/${lang}/auth/sign-out`} method="POST">
                    <button
                      type="submit"
                      className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                    >
                      {authNavCopy.signOut}
                    </button>
                  </form>
                </div>
              ) : (
                <Link
                  href={`/${lang}/sign-in`}
                  className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                >
                  {authNavCopy.signIn}
                </Link>
              )}
              <Link
                href={`/${lang}/listing/new`}
                className="hidden md:inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-semibold tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
              >
                {navCopy.cta}
              </Link>
            </div>
          </nav>
        </header>

        {children}

        <footer className="border-t border-gold-soft">
          <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-16 lg:py-20">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-12 lg:gap-16">
              <div className="md:col-span-5 flex flex-col gap-5">
                <Link
                  href={`/${lang}`}
                  className="font-display italic text-3xl text-ink leading-none"
                >
                  Lixtara
                </Link>
                <p className="text-sm leading-relaxed text-ink/70 max-w-sm">
                  {footerCopy.tagline}
                </p>
                <div className="text-[10px] uppercase tracking-[0.18em] text-ink/55 leading-relaxed">
                  {footerCopy.poweredBy} {BROKERAGE_LICENSED_ENTITY}
                  <br />
                  {footerCopy.licenseLabel} #{BROKER_LICENSE}
                  <br />
                  {BROKERAGE_LOCATION}
                </div>
              </div>

              <div className="md:col-span-2 flex flex-col gap-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {footerCopy.cols.sell}
                </div>
                <Link
                  href={`/${lang}#how-it-works`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.howItWorks}
                </Link>
                <Link
                  href={`/${lang}#pricing`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.pricing}
                </Link>
                <Link
                  href={`/${lang}#faq`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.faq}
                </Link>
              </div>

              <div className="md:col-span-2 flex flex-col gap-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {footerCopy.cols.company}
                </div>
                <Link
                  href={`/${lang}/about`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.about}
                </Link>
                <Link
                  href={`/${lang}/services`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.services}
                </Link>
                <Link
                  href={`/${lang}/contact`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.contact}
                </Link>
              </div>

              <div className="md:col-span-3 flex flex-col gap-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {footerCopy.cols.legal}
                </div>
                <Link
                  href={`/${lang}/terms`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.terms}
                </Link>
                <Link
                  href={`/${lang}/privacy`}
                  className="text-sm text-ink/70 hover:text-gold transition-colors"
                >
                  {footerCopy.links.privacy}
                </Link>
              </div>
            </div>

            <div className="mt-16 pt-8 border-t border-gold-soft flex flex-col md:flex-row md:items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-ink/50">
              <p>© {year} Lixtara. {footerCopy.copyright}</p>
              <p>{footerCopy.equalHousing}</p>
            </div>
          </div>
        </footer>

        <LouiWidget
          openLabel={louiCopy.openLabel}
          closeLabel={louiCopy.closeLabel}
          headerEyebrow={louiCopy.headerEyebrow}
          headerTitle={louiCopy.headerTitle}
          headerSubtitle={louiCopy.headerSubtitle}
          placeholder={louiCopy.placeholder}
          sendLabel={louiCopy.sendLabel}
          emptyTitle={louiCopy.emptyTitle}
          emptyBody={louiCopy.emptyBody}
          suggestions={[...louiCopy.suggestions]}
          toolNotice={louiCopy.toolNotice}
          disclaimer={louiCopy.disclaimer}
        />
      </body>
    </html>
  );
}

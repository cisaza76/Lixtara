"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, Globe, LayoutDashboard, LogOut } from "lucide-react";

interface Props {
  lang: string;
  altLang: string;
  langCode: string;
  user: boolean;
  firstName: string | null;
  nav: {
    buy: string;
    sell: string;
    howItWorks: string;
    pricing: string;
    faq: string;
  };
  auth: {
    greetingPrefix: string;
    dashboard: string;
    signOut: string;
    signIn: string;
  };
  cta: string;
}

export function MobileMenu({
  lang,
  altLang,
  langCode,
  user,
  firstName,
  nav,
  auth,
  cta,
}: Props) {
  const [open, setOpen] = useState(false);
  const link = "py-2 text-sm uppercase tracking-[0.18em] text-ink/70";

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-ink"
      >
        {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 bg-ivory border-b border-gold-soft shadow-lg">
          <div className="mx-auto w-full max-w-7xl px-6 py-5 flex flex-col">
            {user && firstName && (
              <p className="text-sm text-ink/80 pb-3 mb-2 border-b border-gold-soft">
                {auth.greetingPrefix} {firstName}
              </p>
            )}
            <nav className="flex flex-col" onClick={() => setOpen(false)}>
              <Link href={`/${lang}/properties`} className={link}>
                {nav.buy}
              </Link>
              <Link href={`/${lang}/listing/new`} className={link}>
                {nav.sell}
              </Link>
              <Link href={`/${lang}#how-it-works`} className={link}>
                {nav.howItWorks}
              </Link>
              <Link href={`/${lang}#pricing`} className={link}>
                {nav.pricing}
              </Link>
              <Link href={`/${lang}#faq`} className={link}>
                {nav.faq}
              </Link>
            </nav>

            <div className="flex items-center gap-5 pt-3 mt-2 border-t border-gold-soft">
              <Link
                href={`/${altLang}`}
                className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55"
              >
                <Globe className="w-4 h-4" /> {langCode}
              </Link>
              {user ? (
                <>
                  <Link
                    href={`/${lang}/dashboard`}
                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/70"
                  >
                    <LayoutDashboard className="w-4 h-4" /> {auth.dashboard}
                  </Link>
                  <form action={`/${lang}/auth/sign-out`} method="POST">
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55"
                    >
                      <LogOut className="w-4 h-4" /> {auth.signOut}
                    </button>
                  </form>
                </>
              ) : (
                <Link
                  href={`/${lang}/sign-in`}
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55"
                >
                  {auth.signIn}
                </Link>
              )}
            </div>
            <Link
              href={`/${lang}/listing/new`}
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex items-center justify-center px-6 py-3 bg-ink text-ivory text-[10px] font-semibold tracking-[0.22em] uppercase"
            >
              {cta}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

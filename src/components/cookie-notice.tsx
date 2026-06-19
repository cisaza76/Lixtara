"use client";

// Lightweight, dismissible cookie notice. The site uses strictly-necessary
// cookies (auth/session) which don't require consent, so this is an informational
// bar linking to the Cookie Policy — not a blocking consent wall. Dismissal is
// remembered in localStorage.

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "lixtara_cookie_notice_dismissed";

export function CookieNotice({
  lang,
  message,
  learnMore,
  accept,
}: {
  lang: string;
  message: string;
  learnMore: string;
  accept: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Defer the show out of the synchronous effect body (avoids cascading-render
    // lint + a hydration mismatch — SSR and first client render are both empty).
    const id = requestAnimationFrame(() => {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        dismissed = false;
      }
      if (!dismissed) setVisible(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-[1000] border-t border-gold-soft bg-ink/95 backdrop-blur-sm px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-ivory/80">
          {message}{" "}
          <Link
            href={`/${lang}/cookies`}
            className="text-gold underline underline-offset-2 hover:text-ivory"
          >
            {learnMore}
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 self-start sm:self-auto inline-flex items-center justify-center bg-gold px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink transition-colors hover:bg-gold/90"
        >
          {accept}
        </button>
      </div>
    </div>
  );
}

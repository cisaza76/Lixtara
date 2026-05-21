"use client";

// Payment-confirmed card that auto-redirects to the seller's dashboard after a
// short pause (so they can read the confirmation), with a manual link fallback.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props {
  href: string;
  title: string;
  body: string;
  redirectingLabel: string;
  manualLabel: string;
  delayMs?: number;
}

export function DashboardRedirect({
  href,
  title,
  body,
  redirectingLabel,
  manualLabel,
  delayMs = 4000,
}: Props) {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push(href), delayMs);
    return () => clearTimeout(t);
  }, [href, router, delayMs]);

  return (
    <div className="border border-gold bg-gold/5 p-6 flex flex-col gap-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
        {title}
      </p>
      <p className="text-base text-ink leading-relaxed">{body}</p>
      <div className="flex items-center gap-3 text-xs text-ink/55">
        <span className="inline-block w-3 h-3 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        <span>{redirectingLabel}</span>
      </div>
      <Link
        href={href}
        className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
      >
        {manualLabel}
      </Link>
    </div>
  );
}

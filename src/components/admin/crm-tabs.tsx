"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  lang: string;
  labels: { owners: string; campaigns: string; inbox: string };
}

export function CrmTabs({ lang, labels }: Props) {
  const pathname = usePathname();
  const base = `/${lang}/admin/crm`;
  const tabs = [
    { href: `${base}/owners`, label: labels.owners },
    { href: `${base}/campaigns`, label: labels.campaigns },
    { href: `${base}/inbox`, label: labels.inbox },
  ];
  return (
    <nav className="flex gap-6 border-b border-gold-soft">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 pb-2.5 text-[11px] uppercase tracking-[0.2em] transition-colors ${
              active ? "border-gold text-ink" : "border-transparent text-ink/55 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";

type PageKey =
  | "about"
  | "services"
  | "contact"
  | "terms"
  | "privacy"
  | "listingNew";

interface Props {
  lang: Locale;
  pageKey: PageKey;
}

export function ComingSoon({ lang, pageKey }: Props) {
  const copy = t(lang).comingSoon;
  const pageCopy = copy.pages[pageKey];

  return (
    <main className="bg-background text-foreground flex-1 flex items-center justify-center px-6 py-32 lg:py-48">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {pageCopy.eyebrow}
        </p>
        <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight text-ink font-normal">
          {copy.titleBefore}
          <em className="italic text-gold">{copy.titleAccent}</em>
          {copy.titleAfter}
        </h1>
        <p className="text-lg leading-relaxed text-ink/70 max-w-lg">
          {pageCopy.body}
        </p>
        <Link
          href={`/${lang}`}
          className="inline-flex items-center px-10 py-5 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors mt-4"
        >
          {copy.backLink}
        </Link>
      </div>
    </main>
  );
}

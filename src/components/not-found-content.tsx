"use client";

// not-found.tsx no recibe params, así que el idioma sale del primer segmento de la URL
// (/en o /es). El servidor entrega el copy de ambos idiomas y aquí se elige uno.
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NotFoundCopy {
  eyebrow: string;
  title: string;
  body: string;
  homeCta: string;
  listingsCta: string;
}

export function NotFoundContent({ copy }: { copy: { en: NotFoundCopy; es: NotFoundCopy } }) {
  const pathname = usePathname() ?? "";
  const lang = pathname.split("/")[1] === "es" ? "es" : "en";
  const c = copy[lang];

  return (
    <main className="bg-background text-foreground flex-1 flex items-center justify-center px-6 py-32 lg:py-48">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {c.eyebrow}
        </p>
        <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight text-ink font-normal">
          {c.title}
        </h1>
        <p className="text-lg leading-relaxed text-ink/70 max-w-lg">{c.body}</p>
        <div className="flex flex-col sm:flex-row gap-6 sm:items-center mt-4">
          <Link
            href={`/${lang}`}
            className="inline-flex items-center justify-center px-10 py-5 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
          >
            {c.homeCta}
          </Link>
          <Link
            href={`/${lang}/properties`}
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70 hover:text-gold transition-colors"
          >
            {c.listingsCta}
          </Link>
        </div>
      </div>
    </main>
  );
}

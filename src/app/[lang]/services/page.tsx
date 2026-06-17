import { notFound } from "next/navigation";
import Link from "next/link";
import { isLocale, t } from "@/lib/i18n";

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const copy = t(lang).services;
  // Each service routes to where it's actually purchased (in-context).
  const hrefs = [
    `/${lang}/listing/new`,
    `/${lang}/consultations`,
    `/${lang}/listing/new`,
  ];

  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
        <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {copy.eyebrow}
        </p>
        <h1 className="mb-6 max-w-2xl font-display text-4xl font-normal leading-[1.05] tracking-tight text-ink md:text-5xl lg:text-6xl">
          {copy.titleBefore}
          <em className="italic text-gold">{copy.titleAccent}</em>
          {copy.titleAfter}
        </h1>
        <p className="mb-16 max-w-2xl text-base leading-relaxed text-ink/70 lg:mb-20">
          {copy.body}
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8">
          {copy.items.map((item, i) => (
            <div
              key={item.name}
              className="group flex flex-col border border-gold-soft bg-ivory p-7 transition-all duration-300 hover:border-gold/60 hover:shadow-[0_24px_48px_-28px_rgba(28,28,28,0.3)] lg:p-8"
            >
              <p className="mb-1 font-display text-xl leading-tight text-ink">
                {item.name}
              </p>
              <p className="mb-4 font-display text-2xl italic text-gold">
                {item.price}
              </p>
              <p className="flex-1 text-sm leading-relaxed text-ink/70">
                {item.body}
              </p>
              <Link
                href={hrefs[i] ?? `/${lang}/listing/new`}
                className="mt-6 inline-flex items-center gap-1.5 self-start text-[10px] font-semibold uppercase tracking-[0.22em] text-ink transition-colors hover:text-gold"
              >
                {item.cta}
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

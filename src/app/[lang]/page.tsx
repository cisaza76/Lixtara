import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isLocale, t, type Locale } from "@/lib/i18n";

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const copy = t(lang).landing;
  const altLang: Locale = lang === "en" ? "es" : "en";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-2xl flex-col gap-8 text-center sm:text-left">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {copy.eyebrow}
        </p>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          {copy.title}
        </h1>
        <p className="text-lg leading-relaxed text-muted-foreground">
          {copy.subtitle}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg">{copy.ctaPrimary}</Button>
          <Button size="lg" variant="outline">
            {copy.ctaSecondary}
          </Button>
        </div>
        <Link
          href={`/${altLang}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {copy.langToggle}
        </Link>
      </div>
    </main>
  );
}

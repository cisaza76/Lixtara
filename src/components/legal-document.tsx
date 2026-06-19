import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { LegalDoc, LegalSection } from "@/lib/legal/types";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/types";

// Renders any long-form legal document (Terms, Privacy, Cookies, Disclaimers)
// in the brand's editorial style. Server component — content comes from the
// per-document modules in src/lib/legal/.

function Section({ section, level }: { section: LegalSection; level: number }) {
  const Heading = level === 0 ? "h2" : "h3";
  const headingClass =
    level === 0
      ? "font-display text-xl lg:text-2xl text-ink font-normal mt-10 mb-3 scroll-mt-24"
      : "font-display text-base lg:text-lg text-ink font-normal mt-6 mb-2";
  return (
    <section>
      <Heading className={headingClass}>{section.heading}</Heading>
      {section.body.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-ink/75 mb-3">
          {p}
        </p>
      ))}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5 pl-1">
          {section.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/75">
              <span aria-hidden className="mt-1.5 text-gold leading-none">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {section.sub?.map((s, i) => (
        <Section key={i} section={s} level={level + 1} />
      ))}
    </section>
  );
}

export function LegalDocument({
  lang,
  doc,
}: {
  lang: Locale;
  doc: LegalDoc;
}) {
  const copy = t(lang).legal;
  const lastUpdated = new Date(`${LEGAL_LAST_UPDATED}T00:00:00`).toLocaleDateString(
    lang,
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <main className="bg-background text-foreground flex-1">
      <section className="mx-auto w-full max-w-3xl px-6 lg:px-8 pt-12 pb-24 lg:pt-16">
        <Link
          href={`/${lang}`}
          className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
        >
          ← {copy.backHome}
        </Link>

        <h1 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal mt-6">
          {doc.title}
        </h1>
        <p className="mt-3 text-[10px] uppercase tracking-[0.22em] text-ink/45">
          {copy.lastUpdated}: {lastUpdated}
        </p>

        {lang === "es" && (
          <p className="mt-5 border border-gold-soft bg-ivory-strong/40 px-4 py-3 text-xs leading-relaxed text-ink/70">
            {copy.englishControls}
          </p>
        )}

        <div className="mt-8 flex flex-col gap-2">
          {doc.intro.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink/80">
              {p}
            </p>
          ))}
        </div>

        <div className="mt-2">
          {doc.sections.map((s, i) => (
            <Section key={i} section={s} level={0} />
          ))}
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { LegalDoc, LegalSection } from "@/lib/legal/types";
import { LEGAL_DOCS, fillLegalDoc, type LegalDocId } from "@/lib/legal/config";

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
    <section id={section.id} className={section.id ? "scroll-mt-24" : undefined}>
      <Heading className={headingClass}>{section.heading}</Heading>
      {section.body.map((p, i) => (
        // whitespace-pre-line: preserva los saltos de línea de un bloque de
        // dirección (p. ej. el agente DMCA). Los documentos existentes no traen
        // "\n" en su body, así que no cambia su renderizado.
        <p key={i} className="text-sm leading-relaxed text-ink/75 mb-3 whitespace-pre-line">
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
      {section.table && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-xs leading-relaxed text-ink/75">
            <thead>
              <tr>
                {section.table.columns.map((c, i) => (
                  <th key={i} className="border-b border-gold-soft py-2 pr-3 font-semibold text-ink">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((r, i) => (
                <tr key={i} className="border-b border-gold-soft/50 align-top">
                  {r.map((cell, j) => (
                    <td key={j} className="py-2 pr-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.sub?.map((s, i) => (
        <Section key={i} section={s} level={level + 1} />
      ))}
    </section>
  );
}

export function LegalDocument({
  lang,
  doc: rawDoc,
  docId,
}: {
  lang: Locale;
  doc: LegalDoc;
  /** Fecha y versión salen de LEGAL_DOCS (src/lib/legal/config.ts). */
  docId: LegalDocId;
}) {
  const copy = t(lang).legal;
  const meta = LEGAL_DOCS[docId];
  const doc = fillLegalDoc(rawDoc);
  const lastUpdated = new Date(`${meta.updated}T00:00:00`).toLocaleDateString(
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
          {copy.lastUpdated}: {lastUpdated} · {copy.version} {meta.version}
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

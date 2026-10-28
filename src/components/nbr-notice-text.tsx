// El aviso NBR (F.S. 475.278(4)(c)) tal como lo ve el comprador: en /es primero la traducción
// de cortesía y debajo el inglés, que es el que rige. Mismo tamaño de letra que el resto; la
// primera oración en mayúsculas y negrita (475.278(4)(b)). Lo usan el formulario de visita y
// la página del enlace.
import { nbrCopy, noticeTextsFor } from "@/lib/nbr-notice";

export function NbrNoticeText({ lang }: { lang: "en" | "es" }) {
  const c = nbrCopy(lang);
  const texts = noticeTextsFor(lang);
  return (
    <div data-nbr-notice className="flex flex-col gap-4 text-sm text-ink leading-relaxed">
      {texts.map((t, i) => (
        <section key={t.title} lang={i === texts.length - 1 ? "en" : "es"} className="flex flex-col gap-2">
          {lang === "es" && (
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              {i === 0 ? c.courtesyNote : c.governingLabel}
            </p>
          )}
          <p className="font-bold">{t.title}</p>
          <p className="font-bold">{t.lead}</p>
          <p>{t.intro}</p>
          <ol className="flex flex-col gap-1">
            {t.duties.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

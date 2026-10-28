// El aviso NBR (F.S. 475.278(4)(c)) tal como lo ve el comprador: el inglés (el que rige) y, al
// lado, la traducción de cortesía con la línea de que rige el inglés; en pantallas angostas,
// uno debajo del otro, el inglés primero. Todo al mismo tamaño de letra; la primera oración en
// mayúsculas y negrita (475.278(4)(b)). Lo usan el formulario de visita y la página del enlace.
// Antes del aviso, la casilla de consentimiento E-SIGN (15 U.S.C. §7001(c)).
import { CONTACT } from "@/config/contact";
import { NBR_ES_GOVERNING_LINE, esignConsentText, nbrCopy, noticeTextsFor } from "@/lib/nbr-notice";

export function NbrNoticeText({ lang }: { lang: "en" | "es" }) {
  const c = nbrCopy(lang);
  const [en, es] = noticeTextsFor();
  return (
    <div data-nbr-notice className="grid gap-5 md:grid-cols-2 text-sm text-ink leading-relaxed">
      {[
        { t: en, label: c.governingLabel, code: "en" },
        { t: es, label: NBR_ES_GOVERNING_LINE, code: "es" },
      ].map(({ t, label, code }) => (
        <section key={code} lang={code} data-nbr-column={code} className="flex flex-col gap-2">
          <p className="text-sm text-ink/60">{label}</p>
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

/** Casilla de consentimiento E-SIGN, obligatoria y antes del aviso. */
export function EsignConsent({ lang }: { lang: "en" | "es" }) {
  const c = nbrCopy(lang);
  return (
    <label data-esign-consent className="flex items-start gap-2 text-xs text-ink/80 leading-relaxed">
      <input type="checkbox" name="esign_consent" required className="mt-0.5" />
      <span>
        <strong className="font-semibold">{c.esignTitle}. </strong>
        {esignConsentText(lang, { email: CONTACT.inboxEmail, phone: CONTACT.phoneDisplay })}
      </span>
    </label>
  );
}

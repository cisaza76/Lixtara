import { LEGAL_DISCLOSURE_ANCHOR } from "@/config/legalPartner";

/**
 * Texto de un bullet: si termina en "*", el asterisco enlaza a la divulgación de servicios
 * legales de la misma página (#legal-services-disclosure).
 */
export function FootnoteText({ text, lang }: { text: string; lang: "en" | "es" | string }) {
  const label = lang === "es" ? "Ver la divulgación de servicios legales" : "See the legal services disclosure";
  if (!text.endsWith("*")) return <>{text}</>;
  return (
    <>
      {text.slice(0, -1)}
      <a
        href={`#${LEGAL_DISCLOSURE_ANCHOR}`}
        aria-label={label}
        className="text-gold no-underline hover:text-ink"
      >
        *
      </a>
    </>
  );
}

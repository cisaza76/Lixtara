import {
  LEGAL_DISCLOSURE_ANCHOR,
  legalPartnerLink,
  legalPartnerLinkNote,
  legalServicesDisclosure,
} from "@/config/legalPartner";

// Divulgación de servicios legales (decisión del owner 2026-10-16): Lixtara no es una firma de
// abogados; refiere a una firma independiente a la que el cliente contrata y paga directamente.
// Va debajo de la tabla de planes, en la FAQ, en consultas, en servicios y en los Términos.
// El enlace a la firma solo aparece con legalPartner.enabled y una URL https.
export function LegalServicesDisclosure({
  lang,
  anchor = false,
  className = "",
}: {
  lang: "en" | "es";
  /** true en la página con planes: los "*" de los bullets enlazan a este id. */
  anchor?: boolean;
  className?: string;
}) {
  const link = legalPartnerLink();
  return (
    <div
      id={anchor ? LEGAL_DISCLOSURE_ANCHOR : undefined}
      className={`scroll-mt-24 flex flex-col gap-2 text-xs leading-relaxed text-ink/60 ${className}`}
    >
      <p>
        <span aria-hidden>* </span>
        {legalServicesDisclosure(lang)}
      </p>
      {link && (
        <p>
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className="text-gold underline underline-offset-2 hover:text-ink"
          >
            {lang === "es" ? "Ir a la firma de abogados" : "Go to the law firm"}
          </a>{" "}
          <span className="text-ink/45">({legalPartnerLinkNote(lang)})</span>
        </p>
      )}
    </div>
  );
}

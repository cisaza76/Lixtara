// Casilla obligatoria "Acepto los Términos de servicio y la Política de privacidad" al crear la
// cuenta (/sign-up y registro del paso 7). Texto versionado de src/lib/legal/consents.ts
// (`terms`); el servidor la exige (termsAcceptedIn) y registra la aceptación en
// terms_acceptances. Sin JavaScript: `required` en el navegador y la validación en el servidor.
import type { ConsentParts } from "@/lib/legal/consents";
import { LEGAL_DOCS } from "@/lib/legal/config";

export function TermsConsentCheckbox({
  lang,
  parts,
  version,
}: {
  lang: "en" | "es";
  parts: ConsentParts;
  version: string;
}) {
  const link = "underline underline-offset-2 text-ink hover:text-gold";
  return (
    <label className="flex items-start gap-3 text-sm text-ink/80 leading-relaxed cursor-pointer">
      <input
        type="checkbox"
        name="accept_terms"
        value="1"
        required
        className="mt-1 accent-gold w-4 h-4 shrink-0"
      />
      <input type="hidden" name="terms_version" value={version} />
      <span>
        {parts.before}
        <a href={`/${lang}${LEGAL_DOCS.terms.path}`} target="_blank" rel="noopener" className={link}>
          {parts.link}
        </a>
        {parts.middle}
        <a href={`/${lang}${LEGAL_DOCS.privacy.path}`} target="_blank" rel="noopener" className={link}>
          {parts.link2}
        </a>
        {parts.after}
      </span>
    </label>
  );
}

"use client";

// Casilla obligatoria "Acepto los Términos de servicio y la Política de privacidad" al crear la
// cuenta (/sign-up y registro del paso 7). Texto versionado de src/lib/legal/consents.ts
// (`terms`); el servidor la exige (termsAcceptedIn) y registra la aceptación en
// terms_acceptances.
//
// Sin `required` del navegador: su burbuja sale en el idioma del navegador, no en el de la
// página. Si falta la casilla, se detiene el envío y se muestra `requiredMessage` aquí mismo.
// Sin JavaScript el formulario se envía y el servidor responde con el mismo aviso.
import { useEffect, useRef, useState } from "react";
import type { ConsentParts } from "@/lib/legal/consents";
import { LEGAL_DOCS } from "@/lib/legal/config";

export function TermsConsentCheckbox({
  lang,
  parts,
  version,
  requiredMessage,
}: {
  lang: "en" | "es";
  parts: ConsentParts;
  version: string;
  /** Mensaje en el idioma de la página si se intenta enviar sin marcarla. */
  requiredMessage: string;
}) {
  const box = useRef<HTMLInputElement>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const form = box.current?.form;
    if (!form) return;
    function onSubmit(e: SubmitEvent) {
      if (box.current?.checked) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMissing(true);
      box.current?.focus();
    }
    // Captura: corre antes que los manejadores de React del formulario (p. ej. "enviando…").
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, []);

  const link = "underline underline-offset-2 text-ink hover:text-gold";
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-3 text-sm text-ink/80 leading-relaxed cursor-pointer">
        <input
          ref={box}
          type="checkbox"
          name="accept_terms"
          value="1"
          aria-invalid={missing || undefined}
          aria-describedby={missing ? "accept-terms-error" : undefined}
          onChange={(e) => e.currentTarget.checked && setMissing(false)}
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
      {missing && (
        <p id="accept-terms-error" role="alert" className="text-xs text-red-700 leading-relaxed">
          {requiredMessage}
        </p>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";

interface AgreementButtonProps {
  propertyId: string;
  lang: string;
  labels: {
    startButton: string;
    redirecting: string;
    failed: string;
    /** Si se pulsa sin marcar la casilla E-SIGN (idioma de la página, no la burbuja del navegador). */
    consentRequired: string;
  };
  /** Aviso y casilla E-SIGN (src/lib/legal/consents.ts, marcadores ya resueltos). */
  esign: {
    notice: string[];
    checkbox: string;
    /** CONSENTS.esign.version: el servidor exige la vigente. */
    version: string;
  };
}

export function AgreementButton({ propertyId, lang, labels, esign }: AgreementButtonProps) {
  const [accepted, setAccepted] = useState(false);
  const [missing, setMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);

  async function handleClick() {
    if (!accepted) {
      setMissing(true);
      box.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agreement/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          lang,
          accept_esign: true,
          esign_version: esign.version,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string; detail?: string; redirect?: string };
      // Falta algo del listado (p. ej. la oferta del paso 6): volver a ese paso.
      if (!res.ok && data.redirect?.startsWith("/") && !data.redirect.startsWith("//")) {
        window.location.href = data.redirect;
        return;
      }
      if (!res.ok || !data.url) {
        // `detail` is DocuSign's English text: console only.
        if (data.detail) console.error("agreement create failed", data.detail);
        throw new Error(data.error ?? "no_url");
      }
      window.location.href = data.url;
    } catch (e) {
      // Localized message; a machine code (e.g. "agreement_not_signed") may
      // follow for support, but never an English sentence from the API.
      const code = e instanceof Error && /^[a-z0-9_]+$/.test(e.message) ? e.message : null;
      setError(code ? `${labels.failed} (${code})` : labels.failed);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 border border-gold-soft bg-ivory-strong/40 p-4 max-w-xl">
        {esign.notice.map((p, i) => (
          <p key={i} className="text-xs text-ink/75 leading-relaxed">
            {p}
          </p>
        ))}
        <label className="flex items-start gap-3 text-sm text-ink/85 leading-relaxed cursor-pointer pt-1">
          <input
            ref={box}
            type="checkbox"
            name="accept_esign"
            checked={accepted}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? "accept-esign-error" : undefined}
            onChange={(e) => {
              setAccepted(e.currentTarget.checked);
              if (e.currentTarget.checked) setMissing(false);
            }}
            disabled={submitting}
            className="mt-1 accent-gold w-4 h-4 shrink-0"
          />
          <span>{esign.checkbox}</span>
        </label>
        {missing && (
          <p id="accept-esign-error" role="alert" className="text-xs text-red-700 leading-relaxed">
            {labels.consentRequired}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="self-start inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? labels.redirecting : labels.startButton}
      </button>
      {error && (
        <p className="text-xs italic text-red-700 font-mono break-all">
          {error}
        </p>
      )}
    </div>
  );
}

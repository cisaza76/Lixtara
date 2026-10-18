"use client";

import { useRef, useState } from "react";
import { trackThen, type PlanTier } from "@/lib/analytics";
import type { ConsentParts } from "@/lib/legal/consents";

interface CheckoutButtonProps {
  propertyId: string;
  lang: string;
  /** Plan and its fee (from pricing-tiers.ts) for the begin_checkout event. */
  planTier: PlanTier | null;
  value: number | null;
  labels: {
    payButton: string;
    redirecting: string;
    failed: string;
    /** 409 payment_confirming: a previous checkout for this listing is paid or completing. */
    confirming: string;
    /** Si se pulsa sin marcar la casilla (idioma de la página, no la burbuja del navegador). */
    consentRequired: string;
  };
  /**
   * Casilla obligatoria del paso 8 (texto versionado de src/lib/legal/consents.ts, con el precio
   * y la comisión del plan ya resueltos). null = el listing no tiene plan: no se puede pagar.
   */
  refundAck: {
    parts: ConsentParts;
    /** CONSENTS.terms_refund.version: el servidor exige la vigente. */
    version: string;
  } | null;
}

export function CheckoutButton({ propertyId, lang, planTier, value, labels, refundAck }: CheckoutButtonProps) {
  const [accepted, setAccepted] = useState(false);
  const [missing, setMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  async function handleClick() {
    if (!refundAck) return;
    if (!accepted) {
      setMissing(true);
      box.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          lang,
          accept_refund_terms: true,
          refund_terms_version: refundAck.version,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.error === "payment_confirming") {
        // Never open a second checkout: reload so step 8 re-reads the session from Stripe.
        setConfirming(true);
        setSubmitting(false);
        setTimeout(() => window.location.reload(), 4000);
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "no_url");
      }
      const url = data.url;
      const go = () => {
        window.location.href = url;
      };
      // begin_checkout right before leaving for Stripe; the redirect waits for GTM (≤1 s).
      if (planTier && value !== null) {
        trackThen({ event: "begin_checkout", plan_tier: planTier, value, currency: "USD", lang }, go, 1000);
      } else go();
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
      {refundAck && (
        <label className="flex items-start gap-3 text-sm text-ink/80 leading-relaxed cursor-pointer max-w-xl">
          <input
            ref={box}
            type="checkbox"
            name="accept_refund_terms"
            checked={accepted}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? "accept-refund-error" : undefined}
            onChange={(e) => {
              setAccepted(e.currentTarget.checked);
              if (e.currentTarget.checked) setMissing(false);
            }}
            disabled={submitting || confirming}
            className="mt-1 accent-gold w-4 h-4 shrink-0"
          />
          <span>
            {refundAck.parts.before}
            {refundAck.parts.link}
            {refundAck.parts.after}
          </span>
        </label>
      )}
      {missing && (
        <p id="accept-refund-error" role="alert" className="text-xs text-red-700 leading-relaxed max-w-xl">
          {labels.consentRequired}
        </p>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={!refundAck || submitting || confirming}
        className="self-start inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-[11px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? labels.redirecting : labels.payButton}
      </button>
      {confirming && (
        <p role="status" className="text-sm text-ink/80 leading-relaxed">
          {labels.confirming}
        </p>
      )}
      {error && (
        <p className="text-xs italic text-red-700 font-mono break-all">
          {error}
        </p>
      )}
    </div>
  );
}

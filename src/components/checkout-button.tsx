"use client";

import { useState } from "react";
import { trackThen, type PlanTier } from "@/lib/analytics";

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
  };
}

export function CheckoutButton({ propertyId, lang, planTier, value, labels }: CheckoutButtonProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, lang }),
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
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting || confirming}
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

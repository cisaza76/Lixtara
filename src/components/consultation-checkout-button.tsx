"use client";

import { useState } from "react";
import type { ConsultationProduct } from "@/lib/consultations";

interface Props {
  product: ConsultationProduct;
  lang: string;
  label: string;
  variant?: "primary" | "secondary";
  className?: string;
  labels: {
    redirecting: string;
    failed: string;
  };
}

const VARIANTS: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "px-8 py-4 bg-ink text-ivory text-[10px] font-semibold tracking-[0.22em] uppercase hover:bg-ink/85",
  secondary:
    "px-6 py-3 border border-gold-soft text-ink text-[10px] font-semibold tracking-[0.22em] uppercase hover:border-gold",
};

export function ConsultationCheckoutButton({
  product,
  lang,
  label,
  variant = "primary",
  className,
  labels,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/consultation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, lang }),
      });
      // Not signed in → send to sign-in, returning here afterward.
      if (res.status === 401) {
        window.location.href = `/${lang}/sign-in?next=/${lang}/consultations`;
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "no_url");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.failed);
      setSubmitting(false);
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className={`inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]}`}
      >
        {submitting ? labels.redirecting : label}
      </button>
      {error && (
        <p className="text-xs italic text-red-700 font-mono break-all">{error}</p>
      )}
    </div>
  );
}

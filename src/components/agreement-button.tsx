"use client";

import { useState } from "react";

interface AgreementButtonProps {
  propertyId: string;
  lang: string;
  labels: {
    startButton: string;
    redirecting: string;
    failed: string;
  };
}

export function AgreementButton({ propertyId, lang, labels }: AgreementButtonProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agreement/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, lang }),
      });
      const data = (await res.json()) as { url?: string; error?: string; detail?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.detail ?? data.error ?? "no_url");
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.failed);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
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

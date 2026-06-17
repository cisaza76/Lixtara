"use client";

import { useState } from "react";

interface Props {
  propertyId: string;
  lang: string;
  label: string;
  labels: { redirecting: string; failed: string };
}

export function PhotographyCheckoutButton({
  propertyId,
  lang,
  label,
  labels,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/photography", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, lang }),
      });
      if (res.status === 401) {
        window.location.href = `/${lang}/sign-in?next=/${lang}/listing/new`;
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
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="inline-flex items-center justify-center self-start whitespace-nowrap bg-ink px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-ivory transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? labels.redirecting : label}
      </button>
      {error && <p className="text-xs italic text-red-700">{error}</p>}
    </div>
  );
}

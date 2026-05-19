"use client";

import { useState } from "react";

interface SaveButtonProps {
  propertyId: string;
  initiallySaved: boolean;
  signedIn: boolean;
  signInHref: string;
  labels: {
    saveButton: string;
    savedButton: string;
    saveFailed: string;
    removeFailed: string;
  };
}

export function SaveButton({
  propertyId,
  initiallySaved,
  signedIn,
  signInHref,
  labels,
}: SaveButtonProps) {
  const [saved, setSaved] = useState(initiallySaved);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!signedIn) {
      window.location.href = signInHref;
      return;
    }
    setError(null);
    setSubmitting(true);
    const willSave = !saved;
    try {
      const res = await fetch("/api/saves", {
        method: willSave ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      if (!res.ok) {
        throw new Error(willSave ? labels.saveFailed : labels.removeFailed);
      }
      setSaved(willSave);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={submitting}
        aria-pressed={saved}
        className={`inline-flex items-center gap-2 px-4 py-2 border text-[10px] font-medium tracking-[0.18em] uppercase transition-colors disabled:opacity-40 ${
          saved
            ? "border-gold bg-gold/5 text-ink"
            : "border-gold-soft bg-ivory text-ink/70 hover:border-gold hover:text-ink"
        }`}
      >
        <span aria-hidden className={saved ? "text-gold" : "text-ink/40"}>
          {saved ? "♥" : "♡"}
        </span>
        <span>{saved ? labels.savedButton : labels.saveButton}</span>
      </button>
      {error && <p className="text-[10px] italic text-red-700">{error}</p>}
    </div>
  );
}

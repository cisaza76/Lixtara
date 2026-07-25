"use client";

import { useState } from "react";
import type { StrategyPayload } from "@/lib/media-intelligence/types";

interface Copy {
  cta: string;
  generating: string;
  strategyTitle: string;
  audience: string;
  persona: string;
  shots: string;
  deliverables: string;
  approve: string;
  regenerate: string;
  variant: string;
  mockBadge: string;
  disclosure: string;
  tooFewPhotos: string;
  failed: string;
}

export function MediaStrategyPanel({
  propertyId,
  initial,
  copy,
}: {
  propertyId: string;
  initial: StrategyPayload | null;
  copy: Copy;
}) {
  const [payload, setPayload] = useState<StrategyPayload | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/media-agent/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ property_id: propertyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error === "too_few_photos" ? copy.tooFewPhotos : copy.failed);
        return;
      }
      setPayload(data.strategy as StrategyPayload);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-serif text-xl">{copy.strategyTitle}</h3>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? copy.generating : payload ? copy.regenerate : copy.cta}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {payload && (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            <strong>{copy.audience}:</strong> {payload.mediaStrategy.targetAudience}
          </p>
          <p>
            <strong>{copy.persona}:</strong> {payload.mediaStrategy.buyerPersona}
          </p>

          <div>
            <p className="font-medium">{copy.shots}</p>
            <ol className="mt-1 list-decimal pl-5">
              {payload.selectedShots.map((s) => (
                <li key={s.photoId}>
                  {s.roomType} — {s.suggestedMotion}
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="font-medium">{copy.deliverables}</p>
            <ul className="mt-1 grid gap-2 sm:grid-cols-2">
              {payload.deliverables.map((d) => (
                <li key={d.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-center justify-between">
                    <span>{d.kind} · {d.aspect}</span>
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      {copy.mockBadge}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="rounded border px-2 py-1 text-xs">{copy.approve}</button>
                    <button className="rounded border px-2 py-1 text-xs">{copy.variant}</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-neutral-500">{copy.disclosure}</p>
        </div>
      )}
    </section>
  );
}

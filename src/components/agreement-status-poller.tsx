"use client";

// After the seller is redirected back from DocuSign embedded signing we
// optimistically set ?signed=1 in the return URL. Rather than wait for the
// Connect webhook (which hangs the step if Connect is misconfigured), we poll
// /api/agreement/sync — it re-fetches the envelope status DIRECTLY from
// DocuSign and updates the row. Every 3s for up to ~60s; refresh the SSR view
// when status flips so the success card renders without a manual reload.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface AgreementStatusPollerProps {
  propertyId: string;
  label: string;
}

export function AgreementStatusPoller({
  propertyId,
  label,
}: AgreementStatusPollerProps) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const interval = setInterval(async () => {
      if (cancelled || stopped.current || attempts >= maxAttempts) {
        clearInterval(interval);
        return;
      }
      attempts += 1;
      setTick(attempts);
      try {
        const res = await fetch("/api/agreement/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ property_id: propertyId }),
        });
        const data = (await res.json()) as { status?: string };
        if (data.status === "completed" || data.status === "signed") {
          stopped.current = true;
          clearInterval(interval);
          router.refresh();
        }
      } catch {
        // transient — try again next tick
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [propertyId, router]);

  return (
    <div className="flex items-center gap-3 text-xs text-ink/55">
      <span className="inline-block w-3 h-3 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      <span>
        {label} ({tick}/20)
      </span>
    </div>
  );
}

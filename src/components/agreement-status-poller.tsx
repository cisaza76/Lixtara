"use client";

// After the seller is redirected back from DocuSign embedded signing we
// optimistically set ?signed=1 in the return URL, but the Connect webhook
// that flips agreements.status to 'completed' can lag by a few seconds.
// Poll the agreements row every 3s for up to ~60s. Refresh the SSR view
// when status flips so the success card renders without a manual reload.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    const supabase = createClient();
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
      const { data } = await supabase
        .from("agreements")
        .select("status")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.status === "completed" || data?.status === "signed") {
        stopped.current = true;
        clearInterval(interval);
        router.refresh();
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

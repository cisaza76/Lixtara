"use client";

// When Stripe redirects back with ?session_id=... the webhook may not have
// landed yet. Poll the property's mls_status every 2s for up to 15s and
// trigger a router refresh once it flips to 'pending_approval'. After that
// the SSR re-renders the success card.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface PaymentStatusPollerProps {
  propertyId: string;
  label: string;
}

export function PaymentStatusPoller({ propertyId, label }: PaymentStatusPollerProps) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(async () => {
      if (cancelled || stopped.current || attempts >= 8) {
        clearInterval(interval);
        return;
      }
      attempts += 1;
      setTick(attempts);
      const { data } = await supabase
        .from("properties")
        .select("mls_status")
        .eq("id", propertyId)
        .maybeSingle();
      if (
        data?.mls_status === "pending_approval" ||
        data?.mls_status === "active"
      ) {
        stopped.current = true;
        clearInterval(interval);
        router.refresh();
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [propertyId, router]);

  return (
    <div className="flex items-center gap-3 text-xs text-ink/55">
      <span className="inline-block w-3 h-3 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      <span>
        {label} ({tick}/8)
      </span>
    </div>
  );
}

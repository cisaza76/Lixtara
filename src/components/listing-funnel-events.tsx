"use client";

import { useEffect } from "react";
import { listingStepEvent, track } from "@/lib/analytics";

// Pushes the /listing/new funnel events to the dataLayer: one `listing_step_view` per
// step shown, and `email_verified` once when the seller confirms their email code
// (the server action marks that with `?ev=email_verified_gate|email_verified_account`).
export function ListingFunnelEvents({ step, lang }: { step: number; lang: string }) {
  useEffect(() => {
    track(listingStepEvent(step, lang));

    const url = new URL(window.location.href);
    const ev = url.searchParams.get("ev");
    if (ev === "email_verified_gate" || ev === "email_verified_account") {
      track({
        event: "email_verified",
        method: ev === "email_verified_gate" ? "listing_gate" : "account",
        lang,
      });
      // Drop the marker so a reload doesn't count the verification twice.
      url.searchParams.delete("ev");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [step, lang]);

  return null;
}

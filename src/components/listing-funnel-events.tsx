"use client";

import { useEffect } from "react";
import {
  isPlanTier,
  listingStepCompleteEvent,
  listingStepEvent,
  resumeSourceFromMarker,
  track,
} from "@/lib/analytics";

// sessionStorage (this tab only, never sent anywhere): whether this tab has already been in
// the flow, and which listings already reported agreement_signed.
const FLOW_KEY = "lx_listing_flow";
const SIGNED_KEY = "lx_signed";

function firstFlowViewInTab(): boolean {
  try {
    if (window.sessionStorage.getItem(FLOW_KEY) === "1") return false;
    window.sessionStorage.setItem(FLOW_KEY, "1");
    return true;
  } catch {
    return false; // storage blocked: no "direct" resume rather than one per page
  }
}

function firstSignedReport(listingId: string | null): boolean {
  if (!listingId) return true;
  try {
    const seen = (window.sessionStorage.getItem(SIGNED_KEY) ?? "").split(",");
    if (seen.includes(listingId)) return false;
    window.sessionStorage.setItem(SIGNED_KEY, [...seen.filter(Boolean), listingId].join(","));
  } catch {
    /* storage blocked: the URL marker still stops a reload from repeating it */
  }
  return true;
}

// Pushes the /listing/new funnel events to the dataLayer. The server marks what just
// happened in the URL and this component reports it once, then drops the marker so a
// reload doesn't count it twice:
//   ?done=N        step N was validated and saved          → listing_step_complete
//   ?signed=1      back from DocuSign, agreement now signed → agreement_signed (+ step 7 complete)
//   ?resumed=src   arrived through a resume link (email or the dashboard) → listing_resumed
//                  (no marker, first flow view in this tab, unfinished draft → source direct)
//   ?ev=…          email confirmed                          → email_verified
//   ?error=code    a validation error on a known field      → listing_step_error
// Then one `listing_step_view` per step shown.
// Completion events go first, so a funnel reads "step 2 complete" before "step 3 view".
export function ListingFunnelEvents({
  step,
  lang,
  planTier,
  photosCount,
  agreementSigned,
  errorField,
  listingId,
  resumable,
}: {
  step: number;
  lang: string;
  planTier: string | null;
  photosCount?: number;
  agreementSigned: boolean;
  /** Only to avoid reporting a signature twice in this tab; never sent. */
  listingId: string | null;
  /** The seller's own unfinished draft (still `draft`), shown past step 1. */
  resumable: boolean;
  /** Field behind the current `?error=` (validation only), never what the person typed. */
  errorField: string | null;
}) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const tier = isPlanTier(planTier) ? planTier : undefined;
    let changed = false;

    // Before any marker is dropped: a flow marker means the person is already in the flow.
    const firstInTab = firstFlowViewInTab();
    const inFlowMarker = ["done", "signed", "ev", "error", "session_id"].some((k) => params.has(k));
    const marked = resumeSourceFromMarker(params.get("resumed"));
    if (params.has("resumed")) {
      params.delete("resumed");
      changed = true;
    }
    const source = marked ?? (firstInTab && !inFlowMarker ? "direct" : null);
    if (resumable && source) track({ event: "listing_resumed", step, source, lang });

    const done = Number.parseInt(params.get("done") ?? "", 10);
    if (done >= 1 && done <= 6) {
      track(listingStepCompleteEvent({ step: done, lang, planTier, photosCount }));
      params.delete("done");
      changed = true;
    }

    // ?signed=1 stays while the poller waits for DocuSign; it's dropped once signed.
    if (params.get("signed") === "1" && agreementSigned) {
      if (firstSignedReport(listingId)) {
        track(listingStepCompleteEvent({ step: 7, lang, planTier }));
        track({ event: "agreement_signed", ...(tier ? { plan_tier: tier } : {}), lang });
      }
      params.delete("signed");
      changed = true;
    }

    const ev = params.get("ev");
    if (ev === "email_verified_gate" || ev === "email_verified_account") {
      track({
        event: "email_verified",
        method: ev === "email_verified_gate" ? "listing_gate" : "account",
        lang,
      });
      params.delete("ev");
      changed = true;
    }

    if (errorField && params.has("error")) {
      track({ event: "listing_step_error", step, field: errorField, lang });
      params.delete("error");
      changed = true;
    }

    if (changed) window.history.replaceState(window.history.state, "", url);
  }, [step, lang, planTier, photosCount, agreementSigned, errorField, listingId, resumable]);

  useEffect(() => {
    track(listingStepEvent(step, lang, planTier));
    // Una vista por paso mostrado: el plan va como dato, no como motivo para repetirla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, lang]);

  return null;
}

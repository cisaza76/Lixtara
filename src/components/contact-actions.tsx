"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

// WhatsApp / call buttons that report their clicks to the dataLayer, plus the one-time
// `contact_form_submitted` event after the form redirects back with ?sent=1.
export function ContactActions({
  lang,
  whatsappHref,
  telHref,
  whatsappLabel,
  callLabel,
  phoneDisplay,
}: {
  lang: string;
  whatsappHref: string;
  telHref: string;
  whatsappLabel: string;
  callLabel: string;
  phoneDisplay: string;
}) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("sent") !== "1" || !url.searchParams.has("topic")) return;
    track({ event: "contact_form_submitted", topic: url.searchParams.get("topic") ?? "other", lang });
    // Keep ?sent=1 for the banner, drop the marker so a reload doesn't count twice.
    url.searchParams.delete("topic");
    window.history.replaceState(window.history.state, "", url);
  }, [lang]);

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track({ event: "whatsapp_click", location: "contact_page", lang })}
        className="inline-flex items-center justify-center px-8 py-4 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors"
      >
        {whatsappLabel}
      </a>
      <a
        href={telHref}
        onClick={() => track({ event: "phone_click", location: "contact_page", lang })}
        className="inline-flex items-center justify-center px-8 py-4 border border-gold-soft text-ink text-xs font-medium tracking-[0.2em] uppercase hover:border-gold hover:text-gold transition-colors"
      >
        {callLabel} · {phoneDisplay}
      </a>
    </div>
  );
}

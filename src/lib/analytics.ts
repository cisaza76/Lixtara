// dataLayer events for Google Tag Manager. No tag is installed yet: until GTM loads,
// `window.dataLayer` is a plain array nobody reads, so pushing is harmless. GTM decides
// what (if anything) leaves the browser — and that must respect the cookie policy.
//
// Never put personal data (email, name, phone, address, chat text) in an event.

export const LISTING_STEP_SLUGS = [
  "address",
  "plan",
  "details",
  "description",
  "photos",
  "review",
  "agreement",
  "payment",
] as const;

export type ListingStepEvent = { event: "listing_step_view"; step: number; step_name: string; lang: string };

export type AnalyticsEvent =
  | ListingStepEvent
  | { event: "email_verified"; method: "listing_gate" | "account"; lang: string }
  | { event: "loui_open"; lang: string }
  | { event: "loui_message_sent"; message_index: number; lang: string }
  | { event: "contact_form_submitted"; topic: string; lang: string }
  | { event: "whatsapp_click"; location: string; lang: string }
  | { event: "phone_click"; location: string; lang: string };

/** Event for viewing step `step` (1-based) of /listing/new. Step names are stable English slugs. */
export function listingStepEvent(step: number, lang: string): ListingStepEvent {
  const slug = LISTING_STEP_SLUGS[step - 1] ?? `step_${step}`;
  return { event: "listing_step_view", step, step_name: slug, lang };
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function track(e: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(e);
}

// Catálogo ÚNICO de eventos del navegador. Cada evento va a:
//   - `dataLayer` → lo lee Google Tag Manager (GA4: marketing y adquisición);
//   - PostHog → producto (embudos, abandono, cohortes).
// SOLO si el visitante aceptó la analítica en el banner. Antes de eso, o si la rechazó,
// `track()` no hace nada: ningún evento queda encolado para salir después.
//
// Nunca poner datos personales (email, nombre, teléfono, dirección, texto del chat) ni
// contenido o identificadores de fichas del MLS en un evento.
//
// Los eventos COMERCIALES (lead contactado, acuerdo firmado, plan pagado, listing
// publicado) no salen de aquí: se emiten desde el servidor, a partir de cambios de estado
// verificables (src/lib/analytics.server.ts).

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
  // Embudo vendedor
  | ListingStepEvent
  | { event: "email_verified"; method: "listing_gate" | "account"; lang: string }
  // Embudo comprador
  | {
      event: "property_search";
      lang: string;
      page: number;
      sort: string;
      has_price: boolean;
      has_beds: boolean;
      has_baths: boolean;
      county: string | null;
      has_zip: boolean;
      results_bucket: "0" | "1-24" | "25-100" | "100+";
    }
  | { event: "property_open"; lang: string; source: "own" }
  | { event: "showing_request_started"; lang: string; target: "own" | "mls" }
  | { event: "showing_request_submitted"; lang: string; target: "own" | "mls"; exclusive: boolean }
  // Contacto y asistente
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

/** Cubo de resultados: el número exacto no aporta y así nada se parece a un inventario. */
export function resultsBucket(total: number): "0" | "1-24" | "25-100" | "100+" {
  if (total <= 0) return "0";
  if (total <= 24) return "1-24";
  if (total <= 100) return "25-100";
  return "100+";
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

interface CaptureClient {
  capture(event: string, properties?: Record<string, unknown>): void;
}

// Estado de la página: lo fija el banner de consentimiento.
let consentGranted = false;
let posthogClient: CaptureClient | null = null;

/** Lo llama el banner al aceptar (y al cargar la página si ya había aceptado). */
export function enableAnalytics(client: CaptureClient | null): void {
  consentGranted = true;
  posthogClient = client;
}

/** Lo llama el banner al rechazar o al retirar el consentimiento. */
export function disableAnalytics(): void {
  consentGranted = false;
  posthogClient = null;
}

export function analyticsEnabled(): boolean {
  return consentGranted;
}

export function track(e: AnalyticsEvent): void {
  if (typeof window === "undefined" || !consentGranted) return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(e);
  if (posthogClient) {
    const { event, ...props } = e;
    posthogClient.capture(event, props);
  }
}

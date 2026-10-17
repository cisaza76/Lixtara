// Proveedores que tratan datos personales por cuenta de Lixtara. ÚNICA fuente de la lista
// de la Política de Privacidad (sección 4.1 se genera de aquí) y de la prueba
// providers.test.ts, que falla si el código usa un servicio de terceros que no está aquí.
//
// BORRADOR 2026-10 para revisión del abogado de Lixtara. Inventario hecho sobre el código
// del 2026-10-16 (SDKs, hosts de fetch y variables de entorno).

export interface PrivacyProvider {
  id: string;
  /** Como aparece en la política (EN y ES). */
  name: string;
  entity: string;
  purpose_en: string;
  purpose_es: string;
  /** Política de privacidad del proveedor. */
  policyUrl: string;
  /** Texto que aparece en el código cuando se usa (SDK, host o nombre del módulo). */
  codeMarkers: string[];
  /** Solo se carga si la persona acepta las cookies de analítica. */
  consentOnly?: boolean;
}

export const PRIVACY_PROVIDERS: PrivacyProvider[] = [
  {
    id: "supabase",
    name: "Supabase",
    entity: "Supabase, Inc.",
    purpose_en: "authentication, database and file storage (accounts, listings, photos, documents, offers, consent records)",
    purpose_es: "autenticación, base de datos y almacenamiento de archivos (cuentas, listados, fotos, documentos, ofertas, registros de consentimiento)",
    policyUrl: "https://supabase.com/privacy",
    codeMarkers: ["@supabase/"],
  },
  {
    id: "vercel",
    name: "Vercel",
    entity: "Vercel Inc.",
    purpose_en: "hosting of the Service, server logs (including IP address and browser), and the isolated environment that renders listing videos",
    purpose_es: "alojamiento del Servicio, registros del servidor (incluida la dirección IP y el navegador) y el entorno aislado que genera los videos de los listados",
    policyUrl: "https://vercel.com/legal/privacy-policy",
    codeMarkers: ["@vercel/sandbox"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    entity: "Anthropic, PBC",
    purpose_en: "the AI model behind the Loui assistant, the listing-description rewriter and the photo analysis features",
    purpose_es: "el modelo de IA detrás del asistente Loui, de la mejora de descripciones del listado y del análisis de fotos",
    policyUrl: "https://www.anthropic.com/legal/privacy",
    codeMarkers: ["@ai-sdk/anthropic"],
  },
  {
    id: "google-maps",
    name: "Google LLC (Google Maps Platform)",
    entity: "Google LLC",
    purpose_en: "address autocomplete and address validation (geocoding)",
    purpose_es: "autocompletado y validación de direcciones (geocodificación)",
    policyUrl: "https://policies.google.com/privacy",
    codeMarkers: ["maps.googleapis.com"],
  },
  {
    id: "google-analytics",
    name: "Google LLC (Google Analytics)",
    entity: "Google LLC",
    purpose_en: "usage analytics through Google Tag Manager and, after a payment, a server-side purchase event with pseudonymous identifiers, only if you accept analytics cookies",
    purpose_es: "analítica de uso a través de Google Tag Manager y, después de un pago, un evento de compra enviado desde el servidor con identificadores seudónimos, solo si usted acepta las cookies de analítica",
    policyUrl: "https://policies.google.com/privacy",
    codeMarkers: ["googletagmanager.com", "google-analytics.com/mp"],
    consentOnly: true,
  },
  {
    id: "google-gemini",
    name: "Google LLC (Gemini API)",
    entity: "Google LLC",
    purpose_en: "the Living Listing feature, which turns one listing photo into a short video",
    purpose_es: "la función Living Listing, que convierte una foto del listado en un video corto",
    policyUrl: "https://policies.google.com/privacy",
    codeMarkers: ["@google/genai"],
  },
  {
    id: "microsoft-clarity",
    name: "Microsoft (Clarity)",
    entity: "Microsoft Corporation",
    purpose_en: "usage analytics and session recording, only if you accept analytics cookies (see Section 6.1)",
    purpose_es: "análisis de uso y grabación de sesiones, solo si usted acepta las cookies de analítica (consulte la Sección 6.1)",
    policyUrl: "https://privacy.microsoft.com/privacystatement",
    // Se carga solo por Google Tag Manager (nunca desde el código); el marcador es la
    // documentación de Clarity en el código (máscaras y política).
    codeMarkers: ["data-clarity-mask"],
    consentOnly: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    entity: "Stripe, Inc.",
    purpose_en: "payment processing; your card details are entered on Stripe's pages and Lixtara does not store full card numbers",
    purpose_es: "procesamiento de pagos; los datos de su tarjeta se ingresan en las páginas de Stripe y Lixtara no guarda números completos de tarjeta",
    policyUrl: "https://stripe.com/privacy",
    codeMarkers: ['from "stripe"'],
  },
  {
    id: "docusign",
    name: "DocuSign",
    entity: "DocuSign, Inc.",
    purpose_en: "electronic signature of the listing agreement and related documents",
    purpose_es: "firma electrónica del acuerdo de listado y documentos relacionados",
    policyUrl: "https://www.docusign.com/privacy",
    codeMarkers: ["docusign"],
  },
  {
    id: "resend",
    name: "Resend",
    entity: "Resend (Plus Five Five, Inc.)",
    purpose_en: "sending email (verification codes, receipts, notifications)",
    purpose_es: "envío de correos (códigos de verificación, recibos, notificaciones)",
    policyUrl: "https://resend.com/legal/privacy-policy",
    codeMarkers: ['from "resend"'],
  },
  {
    id: "upstash",
    name: "Upstash",
    entity: "Upstash, Inc.",
    purpose_en: "rate limiting and abuse protection, using identifiers such as IP address, account ID or email address",
    purpose_es: "límites de uso y protección contra abusos, con identificadores como la dirección IP, el ID de cuenta o el correo",
    policyUrl: "https://upstash.com/trust/privacy.pdf [VERIFICAR enlace]",
    codeMarkers: ["@upstash/"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare (Turnstile)",
    entity: "Cloudflare, Inc.",
    purpose_en: "bot protection on sign-in, sign-up, password-reset and listing forms",
    purpose_es: "protección contra bots en los formularios de inicio de sesión, registro, cambio de contraseña y listado",
    policyUrl: "https://www.cloudflare.com/privacypolicy/",
    codeMarkers: ["challenges.cloudflare.com"],
  },
  {
    id: "sentry",
    name: "Sentry",
    entity: "Functional Software, Inc.",
    purpose_en: "technical error monitoring, configured not to send cookies, form contents or the text you type",
    purpose_es: "monitoreo técnico de errores, configurado para no enviar cookies, contenidos de formularios ni el texto que usted escribe",
    policyUrl: "https://sentry.io/privacy/",
    codeMarkers: ["@sentry/"],
  },
  {
    id: "rentcast",
    name: "Rentcast",
    entity: "RentCast LLC [VERIFICAR razón social]",
    purpose_en: "estimated property values and comparable sales, using the property address",
    purpose_es: "valores estimados y ventas comparables, a partir de la dirección de la propiedad",
    policyUrl: "https://www.rentcast.io/privacy-policy [VERIFICAR enlace]",
    codeMarkers: ["rentcast"],
  },
  {
    id: "luma",
    name: "Luma AI",
    entity: "Luma AI, Inc.",
    purpose_en: "AI virtual staging of the listing photos you choose",
    purpose_es: "staging virtual con IA de las fotos del listado que usted elija",
    policyUrl: "https://lumalabs.ai/legal/privacy [VERIFICAR enlace]",
    codeMarkers: ["lumalabs"],
  },
  {
    id: "mapbox",
    name: "Mapbox",
    entity: "Mapbox, Inc.",
    purpose_en: "map images on property pages (the property location and your browser's IP address)",
    purpose_es: "imágenes de mapa en las páginas de propiedades (la ubicación de la propiedad y la dirección IP de su navegador)",
    policyUrl: "https://www.mapbox.com/legal/privacy",
    codeMarkers: ["api.mapbox.com"],
  },
  {
    id: "instantly",
    name: "Instantly",
    entity: "Instantly [VERIFICAR razón social]",
    purpose_en: "sending prospecting email to property owners and recording opens, replies, bounces and unsubscribes",
    purpose_es: "envío de correos de prospección a propietarios y registro de aperturas, respuestas, rebotes y bajas",
    policyUrl: "https://instantly.ai/privacy [VERIFICAR enlace]",
    codeMarkers: ["api.instantly.ai"],
  },
  {
    id: "mls",
    name: "Bridge Interactive and MIAMI Association of REALTORS® (MLS)",
    entity: "Bridge Interactive Group, LLC; MIAMI Association of REALTORS®",
    purpose_en: "the MLS listing feed shown on lixtara.com; MLS photos load from the MLS photo servers, which receive your browser's IP address",
    purpose_es: "el feed de listados del MLS que se muestra en lixtara.com; las fotos del MLS se cargan desde sus servidores, que reciben la dirección IP de su navegador",
    policyUrl: "https://www.bridgeinteractive.com/privacy-policy/ [VERIFICAR enlace]",
    codeMarkers: ["bridgedataoutput"],
  },
  {
    id: "miami-dade",
    name: "Miami-Dade County Property Appraiser",
    entity: "Miami-Dade County (government)",
    purpose_en: "public property records used to pre-fill listing details, queried with the property address",
    purpose_es: "registros públicos de propiedades usados para completar los datos del listado, consultados con la dirección de la propiedad",
    policyUrl: "https://www.miamidade.gov/global/disclaimer/privacy.page [VERIFICAR enlace]",
    codeMarkers: ["miamidadepa"],
  },
  {
    id: "posthog",
    name: "PostHog",
    entity: "PostHog, Inc.",
    purpose_en: "product analytics without session recording, only if it is enabled on the site and you accept analytics cookies",
    purpose_es: "analítica de producto sin grabación de sesiones, solo si está activada en el sitio y usted acepta las cookies de analítica",
    policyUrl: "https://posthog.com/privacy",
    codeMarkers: ["posthog-js"],
    consentOnly: true,
  },
];

/** Una línea por proveedor para la Política de Privacidad. */
export function providerBullet(p: PrivacyProvider, lang: "en" | "es"): string {
  const purpose = lang === "es" ? p.purpose_es : p.purpose_en;
  const policy = lang === "es" ? "Política de privacidad" : "Privacy policy";
  return `${p.name} (${p.entity}): ${purpose}. ${policy}: ${p.policyUrl}`;
}

// Proveedores que tratan datos personales por cuenta de Lixtara. ÚNICA fuente de la lista
// de la Política de Privacidad (sección 4.1 se genera de aquí) y de la prueba
// providers.test.ts, que falla si el código usa un servicio de terceros que no está aquí.
//
// Inventario hecho sobre el código (SDKs, hosts de fetch y variables de entorno). Cada enlace
// a la política del proveedor se comprobó el 2026-10-18 (responde 200). Donde no se pudo
// comprobar un enlace, no se publica: el proveedor aparece sin enlace. No se publica la razón
// social del proveedor: solo el nombre con el que se le conoce.

export interface PrivacyProvider {
  id: string;
  /** Como aparece en la política (EN y ES). */
  name: string;
  purpose_en: string;
  purpose_es: string;
  /** Política de privacidad del proveedor (comprobada); sin ella, la política no muestra enlace. */
  policyUrl?: string;
  /** Texto que aparece en el código cuando se usa (SDK, host o nombre del módulo). */
  codeMarkers: string[];
  /** Solo se carga si la persona acepta las cookies de analítica o de publicidad. */
  consentOnly?: boolean;
}

export const PRIVACY_PROVIDERS: PrivacyProvider[] = [
  {
    id: "supabase",
    name: "Supabase",
    purpose_en: "authentication, database and file storage (accounts, listings, photos, documents, offers, consent records)",
    purpose_es: "autenticación, base de datos y almacenamiento de archivos (cuentas, listados, fotos, documentos, ofertas, registros de consentimiento)",
    policyUrl: "https://supabase.com/privacy",
    codeMarkers: ["@supabase/"],
  },
  {
    id: "vercel",
    name: "Vercel",
    purpose_en: "hosting of the Service, server logs (including IP address and browser), and the isolated environment that renders listing videos",
    purpose_es: "alojamiento del Servicio, registros del servidor (incluida la dirección IP y el navegador) y el entorno aislado que genera los videos de los listados",
    policyUrl: "https://vercel.com/legal/privacy-policy",
    codeMarkers: ["@vercel/sandbox"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    purpose_en: "the AI model behind the Loui assistant, the listing-description rewriter and the photo analysis features",
    purpose_es: "el modelo de IA detrás del asistente Loui, de la mejora de descripciones del listado y del análisis de fotos",
    policyUrl: "https://www.anthropic.com/legal/privacy",
    codeMarkers: ["@ai-sdk/anthropic"],
  },
  {
    id: "google-maps",
    name: "Google LLC (Google Maps Platform)",
    purpose_en: "address autocomplete and address validation (geocoding)",
    purpose_es: "autocompletado y validación de direcciones (geocodificación)",
    policyUrl: "https://policies.google.com/privacy",
    codeMarkers: ["maps.googleapis.com"],
  },
  {
    id: "google-analytics",
    name: "Google LLC (Google Analytics)",
    purpose_en: "usage analytics through Google Tag Manager and, after a payment, a server-side purchase event with pseudonymous identifiers, only if you accept analytics cookies",
    purpose_es: "analítica de uso a través de Google Tag Manager y, después de un pago, un evento de compra enviado desde el servidor con identificadores seudónimos, solo si usted acepta las cookies de analítica",
    policyUrl: "https://policies.google.com/privacy",
    codeMarkers: ["googletagmanager.com", "google-analytics.com/mp"],
    consentOnly: true,
  },
  {
    id: "google-ads",
    name: "Google LLC (Google Ads)",
    purpose_en: "measurement of our advertising campaigns and Lixtara ads on other websites, only if you accept advertising cookies (see Section 6.2)",
    purpose_es: "medición de nuestras campañas de publicidad y anuncios de Lixtara en otros sitios, solo si usted acepta las cookies de publicidad (consulte la Sección 6.2)",
    policyUrl: "https://policies.google.com/privacy",
    // Se carga solo por Google Tag Manager; el marcador es su cookie de clic en el código
    // (metadata del Checkout y borrado al rechazar).
    codeMarkers: ["_gcl_aw"],
    consentOnly: true,
  },
  {
    id: "meta",
    name: "Meta Platforms, Inc. (Meta pixel and Conversions API)",
    purpose_en: "measurement of our advertising campaigns and Lixtara ads on Facebook, Instagram and other apps, only if you accept advertising cookies; with that consent, our server may send Meta a hashed email address, IP address and browser user agent (see Section 6.2)",
    purpose_es: "medición de nuestras campañas de publicidad y anuncios de Lixtara en Facebook, Instagram y otras aplicaciones, solo si usted acepta las cookies de publicidad; con ese consentimiento, nuestro servidor puede enviar a Meta el correo convertido en hash, la dirección IP y el agente de usuario del navegador (consulte la Sección 6.2)",
    policyUrl: "https://www.facebook.com/privacy/policy/",
    // Se carga solo por Google Tag Manager; el marcador es su cookie en el código.
    codeMarkers: ["_fbp"],
    consentOnly: true,
  },
  {
    id: "google-gemini",
    name: "Google LLC (Gemini API)",
    purpose_en: "the Living Listing feature, which turns one listing photo into a short video",
    purpose_es: "la función Living Listing, que convierte una foto del listado en un video corto",
    policyUrl: "https://policies.google.com/privacy",
    codeMarkers: ["@google/genai"],
  },
  {
    id: "microsoft-clarity",
    name: "Microsoft (Clarity)",
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
    purpose_en: "payment processing; your card details are entered on Stripe's pages and Lixtara does not store full card numbers",
    purpose_es: "procesamiento de pagos; los datos de su tarjeta se ingresan en las páginas de Stripe y Lixtara no guarda números completos de tarjeta",
    policyUrl: "https://stripe.com/privacy",
    codeMarkers: ['from "stripe"'],
  },
  {
    id: "docusign",
    name: "DocuSign",
    purpose_en: "electronic signature of the listing agreement and related documents",
    purpose_es: "firma electrónica del acuerdo de listado y documentos relacionados",
    policyUrl: "https://www.docusign.com/privacy",
    codeMarkers: ["docusign"],
  },
  {
    id: "resend",
    name: "Resend",
    purpose_en: "sending email (verification codes, receipts, notifications)",
    purpose_es: "envío de correos (códigos de verificación, recibos, notificaciones)",
    policyUrl: "https://resend.com/legal/privacy-policy",
    codeMarkers: ['from "resend"'],
  },
  {
    id: "upstash",
    name: "Upstash",
    purpose_en: "rate limiting and abuse protection, using identifiers such as IP address, account ID or email address",
    purpose_es: "límites de uso y protección contra abusos, con identificadores como la dirección IP, el ID de cuenta o el correo",
    policyUrl: "https://upstash.com/trust/privacy.pdf",
    codeMarkers: ["@upstash/"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare (Turnstile)",
    purpose_en: "bot protection on sign-in, sign-up, password-reset and listing forms",
    purpose_es: "protección contra bots en los formularios de inicio de sesión, registro, cambio de contraseña y listado",
    policyUrl: "https://www.cloudflare.com/privacypolicy/",
    codeMarkers: ["challenges.cloudflare.com"],
  },
  {
    id: "sentry",
    name: "Sentry",
    purpose_en: "technical error monitoring, configured not to send cookies, form contents or the text you type",
    purpose_es: "monitoreo técnico de errores, configurado para no enviar cookies, contenidos de formularios ni el texto que usted escribe",
    policyUrl: "https://sentry.io/privacy/",
    codeMarkers: ["@sentry/"],
  },
  {
    id: "rentcast",
    name: "Rentcast",
    purpose_en: "estimated property values and comparable sales, using the property address",
    purpose_es: "valores estimados y ventas comparables, a partir de la dirección de la propiedad",
    policyUrl: "https://www.rentcast.io/privacy",
    codeMarkers: ["rentcast"],
  },
  {
    id: "luma",
    name: "Luma AI",
    purpose_en: "AI virtual staging of the listing photos you choose",
    purpose_es: "staging virtual con IA de las fotos del listado que usted elija",
    policyUrl: "https://lumalabs.ai/legal/privacy",
    codeMarkers: ["lumalabs"],
  },
  {
    id: "mapbox",
    name: "Mapbox",
    purpose_en: "map images on property pages (the property location and your browser's IP address)",
    purpose_es: "imágenes de mapa en las páginas de propiedades (la ubicación de la propiedad y la dirección IP de su navegador)",
    policyUrl: "https://www.mapbox.com/legal/privacy",
    codeMarkers: ["api.mapbox.com"],
  },
  {
    id: "instantly",
    name: "Instantly",
    purpose_en: "sending prospecting email to property owners and recording opens, replies, bounces and unsubscribes",
    purpose_es: "envío de correos de prospección a propietarios y registro de aperturas, respuestas, rebotes y bajas",
    policyUrl: "https://instantly.ai/privacy",
    codeMarkers: ["api.instantly.ai"],
  },
  {
    id: "mls",
    name: "Bridge Interactive and MIAMI Association of REALTORS® (MLS)",
    purpose_en: "the MLS listing feed shown on lixtara.com; MLS photos load from the MLS photo servers, which receive your browser's IP address",
    purpose_es: "el feed de listados del MLS que se muestra en lixtara.com; las fotos del MLS se cargan desde sus servidores, que reciben la dirección IP de su navegador",
    codeMarkers: ["bridgedataoutput"],
  },
  {
    id: "miami-dade",
    name: "Miami-Dade County Property Appraiser",
    purpose_en: "public property records used to pre-fill listing details, queried with the property address",
    purpose_es: "registros públicos de propiedades usados para completar los datos del listado, consultados con la dirección de la propiedad",
    codeMarkers: ["miamidadepa"],
  },
  {
    id: "posthog",
    name: "PostHog",
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
  return p.policyUrl ? `${p.name}: ${purpose}. ${policy}: ${p.policyUrl}` : `${p.name}: ${purpose}.`;
}

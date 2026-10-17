import type { LegalContent, LegalDoc, LegalSection } from "./types";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_S } from "@/lib/analytics-config";
import { STEP1_FORM_COOKIE, STEP1_FORM_MAX_AGE_S } from "@/lib/listing-step1-form";
import { SIGNUP_EMAIL_COOKIE } from "@/lib/auth/signup-code";
import { FIRST_TOUCH_COOKIE, FIRST_TOUCH_MAX_AGE_S } from "@/lib/funnel-events";

// Política de Cookies. BORRADOR 2026-10 para revisión del abogado de Lixtara.
//
// Tiene que ser cierta en cada estado del sitio, así que se ARMA según lo configurado:
//   - sin NEXT_PUBLIC_GTM_ID ni NEXT_PUBLIC_POSTHOG_KEY: solo cookies necesarias;
//   - con GTM (contenedor del CMO): Google Analytics 4 y Microsoft Clarity, solo con
//     consentimiento (opt-in en todas las regiones);
//   - con PostHog: su analítica de producto, solo con consentimiento.
// Google Ads y Meta NO están aprobados: la sección de publicidad dice que no se usan, en todas
// las variantes. Nombres y duraciones de NUESTRAS cookies salen de las constantes del código.
// Clarity: lista de "Clarity Cookies" (Microsoft Learn, actualizada 2025-12-05); Microsoft ya
// no publica duraciones: las de la tabla son aproximadas (versión anterior de esa página).

export interface CookieTools {
  gtm: boolean;
  posthog: boolean;
}

type Lang = "en" | "es";

const days = (s: number) => Math.round(s / 86400);
const minutes = (s: number) => Math.round(s / 60);

function duration(lang: Lang, kind: "days" | "minutes" | "hours" | "years" | "session", n = 1): string {
  const es = lang === "es";
  switch (kind) {
    case "days":
      return es ? `${n} días` : `${n} days`;
    case "minutes":
      return es ? `${n} minutos` : `${n} minutes`;
    case "hours":
      return es ? (n === 1 ? "1 hora" : `${n} horas`) : n === 1 ? "1 hour" : `${n} hours`;
    case "years":
      return es ? (n === 1 ? "1 año" : `${n} años`) : n === 1 ? "1 year" : `${n} years`;
    case "session":
      return es ? "Sesión (se borra al cerrar el navegador)" : "Session (deleted when you close the browser)";
  }
}

const COLUMNS = {
  en: ["Name", "Provider", "Purpose", "Duration"],
  es: ["Nombre", "Proveedor", "Finalidad", "Duración"],
};

function necessaryRows(lang: Lang): string[][] {
  const es = lang === "es";
  return [
    [
      "sb-<project>-auth-token (may be split into .0, .1)",
      "Lixtara (Supabase Auth)",
      es
        ? "Mantiene su sesión iniciada y protege las acciones de su cuenta y del listado."
        : "Keeps you signed in and protects account and listing actions.",
      es
        ? "Hasta 400 días, o hasta que cierre sesión [VERIFICAR: duración efectiva de la sesión en Supabase]"
        : "Up to 400 days, or until you sign out [VERIFICAR: duración efectiva de la sesión en Supabase]",
    ],
    [
      CONSENT_COOKIE,
      "Lixtara",
      es
        ? "Guarda su elección en el aviso de cookies (aceptar o rechazar la analítica)."
        : "Stores your choice in the cookie banner (accept or reject analytics).",
      duration(lang, "days", days(CONSENT_MAX_AGE_S)),
    ],
    [
      STEP1_FORM_COOKIE,
      "Lixtara",
      es
        ? "Conserva la dirección y el correo que escribió en el paso 1 del listado si el envío falla o si inicia sesión, para que no los pierda."
        : "Keeps the address and email you typed in step 1 of the listing flow if the submission fails or you sign in, so you don't lose them.",
      duration(lang, "minutes", minutes(STEP1_FORM_MAX_AGE_S)),
    ],
    [
      SIGNUP_EMAIL_COOKIE,
      "Lixtara",
      es
        ? "Recuerda el correo con el que se registró para la pantalla del código de verificación, sin ponerlo en la dirección de la página."
        : "Remembers the email you signed up with for the verification-code screen, without putting it in the page address.",
      duration(lang, "hours", 1),
    ],
  ];
}

function analyticsRows(lang: Lang, t: CookieTools): string[][] {
  const es = lang === "es";
  const approx = (en: string, esText: string) => (es ? `Aprox. ${esText}` : `About ${en}`);
  const ms = es ? "Microsoft, en dominios de Microsoft" : "Microsoft, on Microsoft domains";
  const rows: string[][] = [
    [
      FIRST_TOUCH_COOKIE,
      "Lixtara",
      es
        ? "Guarda de qué campaña o sitio llegó por primera vez (parámetros UTM, sin datos personales), para medir nuestras campañas."
        : "Stores which campaign or website first brought you here (UTM parameters, no personal data), to measure our campaigns.",
      duration(lang, "days", days(FIRST_TOUCH_MAX_AGE_S)),
    ],
  ];
  if (t.gtm) {
    rows.push(
      [
        "_ga",
        "Google LLC (Google Analytics 4)",
        es ? "Distingue visitantes para las estadísticas de uso." : "Distinguishes visitors for usage statistics.",
        `${duration(lang, "years", 2)} [VERIFICAR: duración vigente según Google]`,
      ],
      [
        "_ga_<container-id>",
        "Google LLC (Google Analytics 4)",
        es ? "Mantiene el estado de la sesión para las estadísticas de uso." : "Keeps the session state for usage statistics.",
        `${duration(lang, "years", 2)} [VERIFICAR: duración vigente según Google]`,
      ],
      [
        "_clck",
        "Microsoft (Clarity)",
        es ? "Identificador seudónimo de Clarity y sus preferencias en este sitio." : "Clarity's pseudonymous user ID and preferences for this site.",
        approx("1 year", "1 año"),
      ],
      [
        "_clsk",
        "Microsoft (Clarity)",
        es ? "Une las páginas que visita en una misma grabación de sesión." : "Connects the pages you view into a single session recording.",
        approx("1 day", "1 día"),
      ],
      [
        "CLID",
        es ? "Microsoft (Clarity), en dominios de Microsoft" : "Microsoft (Clarity), on Microsoft domains",
        es
          ? "Indica la primera vez que Clarity vio a este navegador en cualquier sitio que use Clarity."
          : "Identifies the first time Clarity saw this browser on any site that uses Clarity.",
        approx("1 year", "1 año"),
      ],
      [
        "MUID",
        ms,
        es
          ? "Identifica navegadores que visitan sitios de Microsoft; Microsoft lo usa para analítica, operación y publicidad. [VERIFICAR: uso publicitario frente a \"No usamos cookies de publicidad\".]"
          : "Identifies browsers visiting Microsoft sites; Microsoft uses it for analytics, operations and advertising. [VERIFICAR: uso publicitario frente a \"No usamos cookies de publicidad\".]",
        approx("1 year", "1 año"),
      ],
      [
        "ANONCHK",
        ms,
        es
          ? "Indica si el MUID se transfiere a otra cookie de Microsoft usada para publicidad; Clarity no la usa y su valor es siempre 0."
          : "Indicates whether MUID is transferred to another Microsoft cookie used for advertising; Clarity does not use it and the value is always 0.",
        approx("10 minutes", "10 minutos"),
      ],
      [
        "MR",
        ms,
        es ? "Indica si hay que renovar el MUID." : "Indicates whether to refresh MUID.",
        approx("7 days", "7 días"),
      ],
      [
        "SM",
        ms,
        es ? "Sincroniza el MUID entre dominios de Microsoft." : "Synchronizes MUID across Microsoft domains.",
        duration(lang, "session"),
      ],
    );
  }
  if (t.posthog) {
    rows.push([
      "ph_<project-key>_posthog (cookie and local storage)",
      "PostHog, Inc.",
      es
        ? "Identificador seudónimo para la analítica de producto, sin grabación de sesiones."
        : "Pseudonymous identifier for product analytics, without session recording.",
      `${duration(lang, "years", 1)} [VERIFICAR: duración según PostHog]`,
    ]);
  }
  return rows;
}

/** Textos de la variante sin analítica; cada variante con analítica los reemplaza (lo comprueba la prueba). */
const NO_ANALYTICS = {
  en: {
    how: "Today we use only cookies that the site needs to work. We do not run analytics tools that use cookies.",
    analytics:
      "We do not currently use analytics cookies. If we add them, we will update this policy and ask for your consent before they are set.",
    consent:
      "Because we only use strictly necessary cookies, the cookie notice informs you about them; there is nothing to accept or reject.",
  },
  es: {
    how: "Hoy solo usamos las cookies que el sitio necesita para funcionar. No usamos herramientas de analítica con cookies.",
    analytics:
      "Actualmente no usamos cookies de analítica. Si las incorporamos, actualizaremos esta política y le pediremos su consentimiento antes de establecerlas.",
    consent:
      "Como solo usamos cookies estrictamente necesarias, el aviso de cookies le informa sobre ellas; no hay nada que aceptar o rechazar.",
  },
} as const;

function toolList(lang: Lang, t: CookieTools): string {
  const items = (
    lang === "es"
      ? [
          t.gtm && "Google Analytics 4 (cargado mediante Google Tag Manager), para medir el tráfico y de dónde llegan las visitas",
          t.gtm && "Microsoft Clarity, para entender cómo se usan las páginas mediante mapas de calor y grabaciones de sesión",
          t.posthog && "PostHog, para entender cómo se usan la búsqueda y el proceso de publicación, sin grabar sesiones",
        ]
      : [
          t.gtm && "Google Analytics 4 (loaded through Google Tag Manager), to measure traffic and where visits come from",
          t.gtm && "Microsoft Clarity, to understand how pages are used through heatmaps and session recordings",
          t.posthog && "PostHog, to understand how search and the listing flow are used, without recording sessions",
        ]
  ).filter(Boolean) as string[];
  const and = lang === "es" ? " y " : ", and ";
  return items.length > 1 ? `${items.slice(0, -1).join(", ")}${and}${items.at(-1)}` : (items[0] ?? "");
}

function build(lang: Lang, t: CookieTools): LegalDoc {
  const es = lang === "es";
  const any = t.gtm || t.posthog;
  const na = NO_ANALYTICS[lang];

  const analytics: LegalSection = {
    id: "analytics",
    heading: es ? "4. Cookies de Analítica (solo con su consentimiento)" : "4. Analytics Cookies (only with your consent)",
    body: any
      ? [
          es
            ? `Solo si usted acepta en el aviso de cookies, usamos ${toolList(lang, t)}. Si rechaza, estas herramientas no se cargan. Los eventos que enviamos nosotros llevan direcciones de página sin parámetros y nunca el texto que usted escribe.`
            : `Only if you accept in the cookie banner, we use ${toolList(lang, t)}. If you reject, these tools are not loaded. The events we send ourselves include page addresses without query parameters and never the text you type.`,
          ...(t.gtm
            ? [
                es
                  ? "Clarity oculta el texto y los datos que usted escribe, y nosotros ocultamos además las fotos, los documentos y las firmas. No se graba su área de cuenta (/account) ni el pago, que procesa Stripe en sus propias páginas."
                  : "Clarity hides the text and data you type, and we also hide photos, documents and signatures. Your account area (/account) and payment, which Stripe processes on its own pages, are not recorded.",
                es
                  ? "Microsoft no publica hoy la duración de las cookies de Clarity; las duraciones de la tabla son aproximadas y las fija Microsoft."
                  : "Microsoft no longer publishes the duration of Clarity's cookies; the durations in the table are approximate and are set by Microsoft.",
              ]
            : []),
        ]
      : [na.analytics],
    ...(any ? { table: { columns: [...COLUMNS[lang]], rows: analyticsRows(lang, t) } } : {}),
  };

  return {
    title: es ? "Política de Cookies" : "Cookie Policy",
    intro: [
      es
        ? "Esta Política de Cookies explica cómo {legalName} (\"Lixtara\") usa cookies y tecnologías similares en lixtara.com. Léala junto con nuestra Política de Privacidad."
        : "This Cookie Policy explains how {legalName} (\"Lixtara\") uses cookies and similar technologies on lixtara.com. Please read it together with our Privacy Policy.",
    ],
    sections: [
      {
        heading: es ? "1. Qué Son las Cookies" : "1. What Cookies Are",
        body: es
          ? [
              "Las cookies son pequeños archivos de texto que un sitio guarda en su navegador. En esta política también llamamos \"cookies\" a tecnologías similares, como el almacenamiento local del navegador.",
              "Las cookies propias las pone Lixtara; las de terceros, otros servicios. Las de sesión se borran al cerrar el navegador; las persistentes duran el tiempo indicado o hasta que usted las borre.",
            ]
          : [
              "Cookies are small text files that a website stores in your browser. In this policy we also call similar technologies, such as the browser's local storage, \"cookies\".",
              "First-party cookies are set by Lixtara; third-party cookies are set by other services. Session cookies are deleted when you close the browser; persistent cookies last for the period shown or until you delete them.",
            ],
      },
      {
        heading: es ? "2. Cómo las Usamos" : "2. How We Use Them",
        body: any
          ? [
              es
                ? "Usamos cookies necesarias para que el sitio funcione y, solo si usted lo acepta, cookies de analítica para entender cómo se usa el sitio y mejorarlo (Sección 4). No usamos cookies de publicidad (Sección 6)."
                : "We use necessary cookies so the site works and, only if you accept them, analytics cookies to understand how the site is used and improve it (Section 4). We do not use advertising cookies (Section 6).",
            ]
          : [na.how],
      },
      {
        id: "necessary",
        heading: es ? "3. Cookies Estrictamente Necesarias" : "3. Strictly Necessary Cookies",
        body: [
          es
            ? "Sin estas cookies usted no podría iniciar sesión, publicar su listado ni guardar su elección sobre las cookies. Por eso no dependen del aviso de cookies."
            : "Without these cookies you could not sign in, publish your listing or save your cookie choice. That is why they do not depend on the cookie banner.",
        ],
        table: { columns: [...COLUMNS[lang]], rows: necessaryRows(lang) },
      },
      analytics,
      {
        id: "technical",
        heading: es ? "5. Herramientas Técnicas sin Cookies" : "5. Technical Tools Without Cookies",
        body: [],
        bullets: es
          ? [
              "Sentry (Functional Software, Inc.): monitoreo de errores. No usa cookies ni almacenamiento local y no sirve para analítica ni publicidad. Cuando ocurre un error envía datos técnicos (mensaje de error, dirección de la página, tipo de navegador) y una señal anónima por visita para medir la estabilidad del sitio. Está configurado para no enviar cookies, contenidos de formularios ni el texto que usted escribe. Como es necesario para que el servicio funcione, no depende del aviso de cookies.",
              "Upstash: límites de uso contra abusos, aplicados en nuestros servidores. No pone cookies en su navegador.",
            ]
          : [
              "Sentry (Functional Software, Inc.): error monitoring. It does not use cookies or local storage and is not used for analytics or advertising. When an error happens it sends technical details (error message, page address, browser type) and an anonymous signal per visit to measure site stability. It is configured not to send cookies, form contents or the text you type. Because it is needed to keep the service working, it does not depend on the cookie banner.",
              "Upstash: rate limits against abuse, applied on our servers. It does not set cookies in your browser.",
            ],
      },
      {
        id: "advertising",
        heading: es ? "6. Publicidad" : "6. Advertising",
        body: [
          es
            ? "No utilizamos cookies de publicidad ni de segmentación. Lixtara no muestra publicidad de terceros y no usa cookies para crear perfiles publicitarios ni para seguirle en otros sitios."
            : "We do not use advertising or targeting cookies. Lixtara does not show third-party advertising and does not use cookies to build advertising profiles or follow you across other websites.",
          ...(t.gtm
            ? [
                es
                  ? "[VERIFICAR: si usted acepta la analítica, Microsoft puede establecer la cookie MUID en sus propios dominios y la describe como usada también para publicidad. Confirmar si la frase anterior puede quedar así.]"
                  : "[VERIFICAR: if you accept analytics, Microsoft may set the MUID cookie on its own domains and describes it as also used for advertising. Confirm whether the sentence above can stay as written.]",
              ]
            : []),
        ],
      },
      {
        id: "third-party",
        heading: es ? "7. Servicios de Terceros que Usted Abre" : "7. Third-Party Services You Open",
        body: [
          es
            ? "Algunas funciones se cargan desde otros servicios, que pueden poner sus propias cookies según sus políticas:"
            : "Some features load from other services, which may set their own cookies under their own policies:",
        ],
        bullets: es
          ? [
              "Stripe, cuando paga (en las páginas de Stripe).",
              "DocuSign, cuando revisa o firma su acuerdo (en las páginas de DocuSign).",
              "Google Maps, en el autocompletado de direcciones del listado.",
              "Mapbox, en los mapas de las páginas de propiedades.",
              "Cloudflare Turnstile, en la verificación contra bots de los formularios. [VERIFICAR: si Turnstile pone cookies y cuáles.]",
              "Los servidores de fotos del MLS, al mostrar las fotos de listados del MLS.",
            ]
          : [
              "Stripe, when you pay (on Stripe's pages).",
              "DocuSign, when you review or sign your agreement (on DocuSign's pages).",
              "Google Maps, for address autocomplete in the listing flow.",
              "Mapbox, for maps on property pages.",
              "Cloudflare Turnstile, for the bot check on forms. [VERIFICAR: si Turnstile pone cookies y cuáles.]",
              "The MLS photo servers, when MLS listing photos are shown.",
            ],
      },
      {
        id: "choices",
        heading: es ? "8. Cómo Elegir o Retirar su Consentimiento" : "8. How to Choose or Withdraw Consent",
        body: any
          ? [
              es
                ? "Cuando visita Lixtara por primera vez, el aviso de cookies le permite aceptar o rechazar las cookies de analítica, con las dos opciones igual de visibles. Nada de analítica se carga antes de que usted acepte."
                : "When you first visit Lixtara, the cookie banner lets you accept or reject analytics cookies, with both options equally visible. No analytics loads before you accept.",
              es
                ? "Puede cambiar su elección en cualquier momento en \"Configurar cookies\", en el pie del sitio. Si retira su consentimiento, estas herramientas dejan de cargarse y las cookies que pusieron en nuestro dominio se borran de su navegador. Las cookies que Microsoft pone en sus propios dominios solo se pueden borrar desde el navegador."
                : "You can change your choice at any time through \"Cookie settings\" in the site footer. If you withdraw consent, these tools stop loading and the cookies they set on our domain are deleted from your browser. Cookies Microsoft sets on its own domains can only be deleted from your browser.",
            ]
          : [na.consent],
        bullets: es
          ? [
              "También puede ver, bloquear o borrar cookies desde la configuración de su navegador.",
              "Si bloquea las cookies necesarias, no podrá iniciar sesión ni usar el proceso de publicación.",
            ]
          : [
              "You can also view, block or delete cookies in your browser settings.",
              "If you block necessary cookies, you will not be able to sign in or use the listing flow.",
            ],
      },
      {
        heading: es ? "9. Cambios a Esta Política" : "9. Changes to This Policy",
        body: [
          es
            ? "Podemos actualizar esta política cuando cambien las herramientas que usamos. La versión y la fecha de \"Última actualización\", al inicio de esta página, cambian con cada actualización."
            : "We may update this policy when the tools we use change. The version and the \"Last updated\" date at the top of this page change with each update.",
        ],
      },
      {
        heading: es ? "10. Contáctenos" : "10. Contact Us",
        body: es
          ? ["Preguntas sobre cookies: {privacyEmail}", "Correo postal: {legalName}, {brokerageAddress}"]
          : ["Questions about cookies: {privacyEmail}", "Mail: {legalName}, {brokerageAddress}"],
      },
    ],
  };
}

const NONE: CookieTools = { gtm: false, posthog: false };

export const cookiesDoc: LegalContent = {
  en: build("en", NONE),
  es: build("es", NONE),
};

/** La política que corresponde al estado real del sitio. */
export function cookiesDocFor(lang: Lang, tools: CookieTools): LegalDoc {
  return tools.gtm || tools.posthog ? build(lang, tools) : cookiesDoc[lang];
}

/** Para las pruebas: los textos de la variante sin analítica que cada variante con analítica reemplaza. */
export function cookieReplacementSources(lang: Lang, tools: CookieTools): string[] {
  if (!tools.gtm && !tools.posthog) return [];
  return Object.values(NO_ANALYTICS[lang]);
}

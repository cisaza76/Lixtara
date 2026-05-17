export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

const dictionaries = {
  en: {
    hero: {
      eyebrow: "Established Florida Brokerage",
      headlineBefore: "Keep up to ",
      headlineAccent: "6%",
      headlineAfter: " of your sale price.",
      subheadline:
        "Licensed brokerage. Full MLS exposure. You keep more equity.",
      ctaPrimary: "Get my selling plan",
      ctaSecondary: "See your savings",
      licenseCaption: "License #",
      metricMlsLabel: "MLS Visibility",
      metricVolumeLabel: "Sales Volume",
      metricYearsLabel: "Market Expertise",
      badgeVerified: "Verified",
      badgeBrokerage: "Licensed Real Estate Brokerage",
      langToggle: "Español",
    },
    valueProps: {
      eyebrow: "Why Lixtara",
      titleBefore: "Three things you ",
      titleAccent: "keep",
      titleAfter: ".",
      props: [
        {
          headline: "Tens of thousands in equity",
          body: "What used to go to a 6% commission stays with you — for closing costs, your next down payment, or whatever's next.",
        },
        {
          headline: "Licensed brokerage on your side",
          body: "AnaMaria and her FL-licensed team handle contracts, disclosures, and the legal mechanics — you're never alone.",
        },
        {
          headline: "Full MLS exposure, every major site",
          body: "Your listing reaches MLS, Zillow, Realtor.com, Redfin, and Trulia — the same buyer pool as a traditional 6% agent.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "How it works",
      titleBefore: "From ",
      titleAccent: "plan",
      titleAfter: " to closed.",
      steps: [
        {
          label: "Step 1",
          headline: "Get your pricing report",
          body: "Free, no obligation. Our broker reviews comparable sales and returns a realistic price band within 48 hours.",
        },
        {
          label: "Step 2",
          headline: "Choose your tier",
          body: "Essentials, Pro, or Concierge — match the level of support to your needs and the complexity of your sale.",
        },
        {
          label: "Step 3",
          headline: "List on MLS",
          body: "Your listing goes live on MLS, syndicated to Zillow, Realtor.com, Redfin, and Trulia — full buyer reach.",
        },
        {
          label: "Step 4",
          headline: "Close with broker support",
          body: "Offers, negotiations, disclosures, DocuSign — AnaMaria and team handle the legal mechanics end-to-end.",
        },
      ],
    },
  },
  es: {
    hero: {
      eyebrow: "Brokerage establecido en Florida",
      headlineBefore: "Quedate con hasta el ",
      headlineAccent: "6%",
      headlineAfter: " del precio de venta.",
      subheadline:
        "Brokerage licenciada. Visibilidad MLS completa. Te quedas con más equity.",
      ctaPrimary: "Obtener mi plan de venta",
      ctaSecondary: "Ver tu ahorro",
      licenseCaption: "Licencia #",
      metricMlsLabel: "Visibilidad MLS",
      metricVolumeLabel: "Volumen de Ventas",
      metricYearsLabel: "Experiencia",
      badgeVerified: "Verificada",
      badgeBrokerage: "Corretaje Inmobiliario Licenciado",
      langToggle: "English",
    },
    valueProps: {
      eyebrow: "Por qué Lixtara",
      titleBefore: "Tres cosas que son ",
      titleAccent: "tuyas",
      titleAfter: ".",
      props: [
        {
          headline: "Decenas de miles en equity",
          body: "Lo que iba a una comisión del 6% se queda contigo — para closing, tu próximo down payment, o lo que sigue.",
        },
        {
          headline: "Brokerage licenciada a tu lado",
          body: "AnaMaria y su equipo licenciado en Florida manejan contratos, disclosures, y la mecánica legal — nunca solo.",
        },
        {
          headline: "Exposición MLS completa, todos los sitios",
          body: "Tu listing llega a MLS, Zillow, Realtor.com, Redfin y Trulia — el mismo pool de compradores que un agente tradicional del 6%.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "Cómo funciona",
      titleBefore: "Del ",
      titleAccent: "plan",
      titleAfter: " al cierre.",
      steps: [
        {
          label: "Paso 1",
          headline: "Recibe tu reporte de precio",
          body: "Gratis, sin compromiso. La broker revisa ventas comparables y te entrega un rango realista en 48 horas.",
        },
        {
          label: "Paso 2",
          headline: "Elige tu tier",
          body: "Essentials, Pro o Concierge — el nivel de soporte que se ajusta a tus necesidades y a la complejidad de tu venta.",
        },
        {
          label: "Paso 3",
          headline: "Publica en MLS",
          body: "Tu listing va al MLS y se sindica a Zillow, Realtor.com, Redfin y Trulia — alcance completo de compradores.",
        },
        {
          label: "Paso 4",
          headline: "Cierra con respaldo del broker",
          body: "Ofertas, negociaciones, disclosures, DocuSign — AnaMaria y su equipo manejan toda la mecánica legal.",
        },
      ],
    },
  },
} as const;

export function t(locale: Locale) {
  return dictionaries[locale];
}

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
  },
} as const;

export function t(locale: Locale) {
  return dictionaries[locale];
}

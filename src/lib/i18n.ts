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
  },
} as const;

export function t(locale: Locale) {
  return dictionaries[locale];
}

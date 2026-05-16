export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

const dictionaries = {
  en: {
    landing: {
      eyebrow: "Phase 0 — scaffold",
      title: "Lixtara",
      subtitle:
        "Sell your Florida home for 0% commission, backed by a licensed broker.",
      ctaPrimary: "Get started",
      ctaSecondary: "How it works",
      langToggle: "Español",
    },
  },
  es: {
    landing: {
      eyebrow: "Fase 0 — scaffold",
      title: "Lixtara",
      subtitle:
        "Vende tu casa en Florida con 0% de comisión, respaldado por una broker licenciada.",
      ctaPrimary: "Empezar",
      ctaSecondary: "Cómo funciona",
      langToggle: "English",
    },
  },
} as const;

export function t(locale: Locale) {
  return dictionaries[locale];
}

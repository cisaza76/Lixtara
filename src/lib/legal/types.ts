// Shared shape for the long-form legal documents (Terms, Privacy, Cookies,
// Disclaimers). Content lives in per-document modules as { en, es } so it never
// bloats the i18n dictionary, and the LegalDocument component renders any doc.

export interface LegalSection {
  heading: string;
  /** Body paragraphs (plain text). */
  body: string[];
  /** Optional bullet list rendered after the body. */
  bullets?: string[];
  /** Optional nested subsections. */
  sub?: LegalSection[];
}

export interface LegalDoc {
  title: string;
  /** One or more intro paragraphs shown above the numbered sections. */
  intro: string[];
  sections: LegalSection[];
}

export interface LegalContent {
  en: LegalDoc;
  es: LegalDoc;
}

/** Single source for the "last updated / effective" date shown on every doc. */
export const LEGAL_LAST_UPDATED = "2026-09-02";

/** Terms of Service: textos v1 (2026-10-18): jerarquía (§1), arbitraje (§17), §4.1 compensación v3, §6 reembolso v2, correos legales. */
export const TERMS_LAST_UPDATED = "2026-10-18";

/** Cookie Policy: cookies de Microsoft Clarity detalladas (y antes, #193: solo analítica). */
export const COOKIES_LAST_UPDATED = "2026-10-16";

/** Disclaimers (Avisos Legales): Lixtara LLC, dirección y licencias desde brokerage.ts (2026-10-18). */
export const DISCLAIMERS_LAST_UPDATED = "2026-10-18";

/** Privacy Policy: 7.1 prueba del consentimiento y Lixtara LLC (2026-10-18); antes 6.1, Clarity. */
export const PRIVACY_LAST_UPDATED = "2026-10-18";

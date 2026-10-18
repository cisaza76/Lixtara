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

/** Terms of Service: §6, reembolso alineado con la política publicada (refundPolicy). */
export const TERMS_LAST_UPDATED = "2026-10-17";

/** Cookie Policy: cookies de Microsoft Clarity detalladas (y antes, #193: solo analítica). */
export const COOKIES_LAST_UPDATED = "2026-10-16";

/** Privacy Policy: sección 6.1, análisis de uso y grabación de sesiones (Microsoft Clarity). */
export const PRIVACY_LAST_UPDATED = "2026-10-16";

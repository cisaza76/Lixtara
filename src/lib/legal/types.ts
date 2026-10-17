// Shared shape for the long-form legal documents (Terms, Privacy, Cookies,
// Disclaimers). Content lives in per-document modules as { en, es } so it never
// bloats the i18n dictionary, and the LegalDocument component renders any doc.

export interface LegalSection {
  /** Ancla estable para enlazar la sección (p. ej. "refunds" → /terms#refunds). */
  id?: string;
  heading: string;
  /** Body paragraphs (plain text). */
  body: string[];
  /** Optional bullet list rendered after the body. */
  bullets?: string[];
  /** Optional table rendered after the bullets (e.g. the cookie list). */
  table?: { columns: string[]; rows: string[][] };
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

// Fechas y versiones de cada documento: src/lib/legal/config.ts (LEGAL_DOCS).

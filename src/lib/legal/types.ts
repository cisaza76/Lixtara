// Shared shape for the long-form legal documents (Terms, Privacy, Cookies,
// Disclaimers, Notices, Accessibility, DMCA). Content lives in per-document modules as
// { en, es } so it never bloats the i18n dictionary, and the LegalDocument component renders
// any doc. Ruta, versión y fecha de cada documento: src/lib/legal/config.ts (LEGAL_DOCS).

export interface LegalSection {
  /** Ancla estable para enlazar la sección (p. ej. "section-17" → /terms#section-17). */
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

/** Fecha de "última actualización" de los documentos que no cambiaron desde entonces (DMCA). */
export const LEGAL_LAST_UPDATED = "2026-09-02";

/** Versión publicada v2 (2026-10-18): Términos, Privacidad, Cookies, Avisos legales, Avisos de corretaje y Accesibilidad. */
export const LEGAL_V2_PUBLISHED = "2026-10-18";

/** Versión v3 (2026-10-21): solo los Términos (§6 y §16, párrafo 15 del acuerdo de listado). */
export const LEGAL_V3_PUBLISHED = "2026-10-21";

/**
 * Terms of Service v3: §6 con el modelo final (tarifa fija no reembolsable una vez publicada,
 * terminación sin costo, comisión solo al cierre); §16 remite al párrafo 15 (Additional Terms)
 * del acuerdo de listado y explica el período de protección. v2: §14/§15 sin límite para fraude
 * y deberes no limitables.
 */
export const TERMS_LAST_UPDATED = LEGAL_V3_PUBLISHED;

/** v4 (2026-10-24): Privacidad y Cookies con la categoría Publicidad (Meta y Google Ads). */
export const LEGAL_V4_PUBLISHED = "2026-10-24";

/** Cookie Policy v5 (2026-11-02): lx_ft con UTM (Analítica) y gclid/gbraid/wbraid (Publicidad); fila de _gcl_gb (2026-11-04, antes de publicarse). */
export const COOKIES_V5_PUBLISHED = "2026-11-02";

/** Cookie Policy v5 sobre la v4 (categoría Publicidad: _fbp, _fbc, _gcl_au, _gcl_aw, _gcl_gb, aparte de Analítica). */
export const COOKIES_LAST_UPDATED = COOKIES_V5_PUBLISHED;

/** Disclaimers (Avisos Legales) v2: aviso IDX, valuaciones, registros públicos e IA. */
export const DISCLAIMERS_LAST_UPDATED = LEGAL_V2_PUBLISHED;

/** Privacy Policy v5 (2026-11-11, aprobada por el owner): §6.2 API de Conversiones de Meta, §4.1, §4.6 y §6.3. */
export const PRIVACY_V5_PUBLISHED = "2026-11-11";

/** Privacy Policy v5 sobre la v4 (§4.6 compartición para publicidad con consentimiento, §6.2 publicidad, §6.3 retiro, §9.1 GPC). */
export const PRIVACY_LAST_UPDATED = PRIVACY_V5_PUBLISHED;

/** Avisos de corretaje, vivienda justa y fraude (/notices), primera publicación. */
export const NOTICES_LAST_UPDATED = LEGAL_V2_PUBLISHED;

/** Declaración de accesibilidad (/accessibility), primera publicación. */
export const ACCESSIBILITY_LAST_UPDATED = LEGAL_V2_PUBLISHED;

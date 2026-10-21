// Configuración ÚNICA de los documentos legales: ruta, versión y fecha de "Última
// actualización" de cada uno, y los marcadores que usan sus textos y las casillas de
// consentimiento. Ningún texto escribe a mano un correo, un nombre legal, una licencia, una
// dirección, un precio ni un porcentaje: salen de src/config/brokerage.ts,
// src/config/legal-terms.ts y src/lib/pricing-tiers.ts.
//
// v2 publicada el 2026-10-18 por decisión del owner, sin revisión del abogado todavía
// (docs/legal/2026-10-18-textos-v2-memo.md). v3 de los Términos (2026-10-21, decisión de la
// broker y del owner): §6 con la terminación sin costo y la comisión al cierre, y §16 con el
// párrafo 15 del acuerdo de listado y el período de protección; los demás documentos
// siguen en la v2 (docs/legal/2026-10-21-textos-v3-memo.md). Al publicar una versión nueva: cambiar `version`
// aquí (y la fecha en types.ts). Las aceptaciones ya registradas conservan su versión.
import { BROKERAGE, LEGAL_EMAIL, NOTICES_EMAIL, PRIVACY_EMAIL, SUPPORT_EMAIL } from "@/config/brokerage";
import { PUBLICATION_BUSINESS_DAYS } from "@/config/legal-terms";
import { PHOTOGRAPHY_ADDON_PRICE, PRICING_TIERS, formatPrice, type PricingTierId } from "@/lib/pricing-tiers";
import { STAGING_FREE_QUOTA, STAGING_OVERAGE_PRICE } from "@/lib/staging";
import {
  ACCESSIBILITY_LAST_UPDATED,
  COOKIES_LAST_UPDATED,
  DISCLAIMERS_LAST_UPDATED,
  LEGAL_LAST_UPDATED,
  NOTICES_LAST_UPDATED,
  PRIVACY_LAST_UPDATED,
  TERMS_LAST_UPDATED,
  type LegalDoc,
  type LegalSection,
} from "./types";

export type LegalDocId = "terms" | "privacy" | "cookies" | "disclaimers" | "notices" | "accessibility" | "dmca";

export interface LegalDocMeta {
  /** Ruta sin idioma: /[lang]{path}. */
  path: string;
  /** Versión que se muestra en la página y se guarda con cada aceptación (terms_acceptances.version). */
  version: string;
  /** YYYY-MM-DD: "Última actualización". */
  updated: string;
}

export const LEGAL_DOCS = {
  terms: { path: "/terms", version: "2026-10-21-v3", updated: TERMS_LAST_UPDATED },
  privacy: { path: "/privacy", version: "2026-10-18-v2", updated: PRIVACY_LAST_UPDATED },
  cookies: { path: "/cookies", version: "2026-10-18-v2", updated: COOKIES_LAST_UPDATED },
  disclaimers: { path: "/disclaimers", version: "2026-10-18-v2", updated: DISCLAIMERS_LAST_UPDATED },
  notices: { path: "/notices", version: "2026-10-18-v2", updated: NOTICES_LAST_UPDATED },
  accessibility: { path: "/accessibility", version: "2026-10-18-v2", updated: ACCESSIBILITY_LAST_UPDATED },
  dmca: { path: "/dmca", version: "2026-09-02-v1", updated: LEGAL_LAST_UPDATED },
} as const satisfies Record<LegalDocId, LegalDocMeta>;

/** {fee} y {pct} del plan, tal como los muestra el sitio ("$199", "0.5%"). */
export function planConsentVars(tier: PricingTierId): { fee: string; pct: string } {
  const t = PRICING_TIERS[tier];
  return { fee: formatPrice(t.flatFee), pct: `${t.commissionPct}%` };
}

/** Marcadores disponibles en todos los textos legales y en las casillas de consentimiento. */
export function legalPlaceholders(): Record<string, string> {
  const t = PRICING_TIERS;
  return {
    "{legalName}": BROKERAGE.legalName,
    "{brokerageLicense}": BROKERAGE.brokerageLicense,
    "{brokerName}": BROKERAGE.brokerName,
    "{brokerLicense}": BROKERAGE.brokerLicense,
    "{brokerageAddress}": BROKERAGE.address,
    "{essentialsFee}": formatPrice(t.essentials.flatFee),
    "{proFee}": formatPrice(t.pro.flatFee),
    "{conciergeFee}": formatPrice(t.concierge.flatFee),
    "{essentialsPct}": String(t.essentials.commissionPct),
    "{proPct}": String(t.pro.commissionPct),
    "{conciergePct}": String(t.concierge.commissionPct),
    "{termMonths}": String(t.essentials.termMonths),
    "{photoAddonPrice}": formatPrice(PHOTOGRAPHY_ADDON_PRICE),
    "{stagingFreeQuota}": String(STAGING_FREE_QUOTA),
    "{stagingOveragePrice}": formatPrice(STAGING_OVERAGE_PRICE),
    "{publicationBusinessDays}": String(PUBLICATION_BUSINESS_DAYS),
    "{supportEmail}": SUPPORT_EMAIL,
    "{privacyEmail}": PRIVACY_EMAIL,
    "{legalEmail}": LEGAL_EMAIL,
    "{noticesEmail}": NOTICES_EMAIL,
  };
}

/** Reemplaza los marcadores. {fee}/{pct} solo si se pasa el plan. */
export function fillLegalCopy(text: string, vars?: { fee: string; pct: string }): string {
  let out = text;
  for (const [k, v] of Object.entries(legalPlaceholders())) out = out.replaceAll(k, v);
  if (vars) out = out.replaceAll("{fee}", vars.fee).replaceAll("{pct}", vars.pct);
  return out;
}

function fillSection(s: LegalSection): LegalSection {
  return {
    ...(s.id ? { id: s.id } : {}),
    heading: fillLegalCopy(s.heading),
    body: s.body.map((p) => fillLegalCopy(p)),
    ...(s.bullets ? { bullets: s.bullets.map((b) => fillLegalCopy(b)) } : {}),
    ...(s.table
      ? {
          table: {
            columns: s.table.columns.map((c) => fillLegalCopy(c)),
            rows: s.table.rows.map((r) => r.map((cell) => fillLegalCopy(cell))),
          },
        }
      : {}),
    ...(s.sub ? { sub: s.sub.map(fillSection) } : {}),
  };
}

/** El documento con todos los marcadores reemplazados (lo usan LegalDocument y el paquete del abogado). */
export function fillLegalDoc(doc: LegalDoc): LegalDoc {
  return {
    title: fillLegalCopy(doc.title),
    intro: doc.intro.map((p) => fillLegalCopy(p)),
    sections: doc.sections.map(fillSection),
  };
}

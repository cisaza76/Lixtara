// Configuración ÚNICA de los documentos legales: ruta, versión y fecha de "Última
// actualización" de cada uno, y los marcadores que sus textos usan para los datos de la
// correduría (src/config/brokerage.ts) y los precios (src/lib/pricing-tiers.ts). Ningún
// documento escribe a mano un número de licencia, una dirección, un precio ni un porcentaje.
//
// BORRADOR 2026-10 pendiente de revisión del abogado de Lixtara (docs/legal/memo-revision-*).
// Al publicar una versión revisada: cambiar `version` y `updated` del documento aquí.
import { BROKERAGE } from "@/config/brokerage";
import { PUBLICATION_BUSINESS_DAYS } from "@/config/publication";
import { PHOTOGRAPHY_ADDON_PRICE, PRICING_TIERS } from "@/lib/pricing-tiers";
import { STAGING_FREE_QUOTA, STAGING_OVERAGE_PRICE } from "@/lib/staging";
import type { LegalDoc, LegalSection } from "./types";

export type LegalDocId =
  | "terms"
  | "privacy"
  | "cookies"
  | "disclaimers"
  | "notices"
  | "accessibility"
  | "dmca";

export interface LegalDocMeta {
  /** Ruta sin idioma: /[lang]{path}. */
  path: string;
  /** Versión que se guarda con cada aceptación (terms_acceptances.version). */
  version: string;
  /** YYYY-MM-DD: "Última actualización". */
  updated: string;
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDocMeta> = {
  terms: { path: "/terms", version: "2026-10-16-draft", updated: "2026-10-16" },
  privacy: { path: "/privacy", version: "2026-10-16-draft", updated: "2026-10-16" },
  cookies: { path: "/cookies", version: "2026-10-16-draft", updated: "2026-10-16" },
  disclaimers: { path: "/disclaimers", version: "2026-10-16-draft", updated: "2026-10-16" },
  notices: { path: "/notices", version: "2026-10-16-draft", updated: "2026-10-16" },
  accessibility: { path: "/accessibility", version: "2026-10-16-draft", updated: "2026-10-16" },
  dmca: { path: "/dmca", version: "2026-10-16-draft", updated: "2026-10-16" },
};

export { PUBLICATION_BUSINESS_DAYS };

/**
 * Precios y plazos con los que se redactó la versión vigente de los Términos. Si cambia un
 * precio, un porcentaje, el plazo o la publicación, src/lib/legal/site-coherence.test.ts falla
 * hasta que se actualice esta foto Y se publique una versión nueva de los Términos (version +
 * updated arriba), porque los vendedores aceptan la versión en el paso 8.
 */
export const TERMS_PRICING_SNAPSHOT = {
  termsVersion: "2026-10-16-draft",
  tiers: {
    essentials: { flatFee: 199, commissionPct: 0.5, termMonths: 24, includesPhotography: false },
    pro: { flatFee: 495, commissionPct: 1, termMonths: 24, includesPhotography: true },
    concierge: { flatFee: 995, commissionPct: 1.5, termMonths: 24, includesPhotography: true },
  },
  photoAddonPrice: 495,
  stagingFreeQuota: 5,
  stagingOveragePrice: 5,
  publicationBusinessDays: 2,
} as const;

export const SUPPORT_EMAIL = "support@lixtara.com";
export const PRIVACY_EMAIL = "privacy@lixtara.com";
export const ACCESSIBILITY_EMAIL = "accessibility@lixtara.com"; // [VERIFICAR que el buzón exista]

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Marcadores disponibles en TODOS los textos legales. */
export function legalPlaceholders(): Record<string, string> {
  const t = PRICING_TIERS;
  return {
    "{legalName}": BROKERAGE.legalName,
    "{brokerageLicense}": BROKERAGE.brokerageLicense,
    "{brokerName}": BROKERAGE.brokerName,
    "{brokerLicense}": BROKERAGE.brokerLicense,
    "{brokerageAddress}": BROKERAGE.address,
    "{essentialsFee}": usd(t.essentials.flatFee),
    "{proFee}": usd(t.pro.flatFee),
    "{conciergeFee}": usd(t.concierge.flatFee),
    "{essentialsPct}": String(t.essentials.commissionPct),
    "{proPct}": String(t.pro.commissionPct),
    "{conciergePct}": String(t.concierge.commissionPct),
    "{termMonths}": String(t.essentials.termMonths),
    "{photoAddonPrice}": usd(PHOTOGRAPHY_ADDON_PRICE),
    "{stagingFreeQuota}": String(STAGING_FREE_QUOTA),
    "{stagingOveragePrice}": usd(STAGING_OVERAGE_PRICE),
    "{publicationBusinessDays}": String(PUBLICATION_BUSINESS_DAYS),
    "{supportEmail}": SUPPORT_EMAIL,
    "{privacyEmail}": PRIVACY_EMAIL,
    "{accessibilityEmail}": ACCESSIBILITY_EMAIL,
  };
}

export function fillLegalCopy(text: string): string {
  let out = text;
  for (const [k, v] of Object.entries(legalPlaceholders())) out = out.replaceAll(k, v);
  return out;
}

function fillSection(s: LegalSection): LegalSection {
  return {
    ...(s.id ? { id: s.id } : {}),
    heading: fillLegalCopy(s.heading),
    body: s.body.map(fillLegalCopy),
    ...(s.bullets ? { bullets: s.bullets.map(fillLegalCopy) } : {}),
    ...(s.table
      ? { table: { columns: s.table.columns.map(fillLegalCopy), rows: s.table.rows.map((r) => r.map(fillLegalCopy)) } }
      : {}),
    ...(s.sub ? { sub: s.sub.map(fillSection) } : {}),
  };
}

/** El documento con todos los marcadores reemplazados (lo usa LegalDocument). */
export function fillLegalDoc(doc: LegalDoc): LegalDoc {
  return {
    title: fillLegalCopy(doc.title),
    intro: doc.intro.map(fillLegalCopy),
    sections: doc.sections.map(fillSection),
  };
}

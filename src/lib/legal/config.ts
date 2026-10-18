// Versiones de los documentos legales que se aceptan con prueba (terms_acceptances) y los
// marcadores de los textos de consentimiento. Ningún texto escribe a mano un correo, un
// nombre legal, un precio ni un porcentaje: salen de src/config/brokerage.ts y de
// src/lib/pricing-tiers.ts.
//
// Textos v1 PENDIENTES DE APROBACIÓN LEGAL (docs/legal/2026-10-18-textos-v1-memo.md). Al
// publicar una versión revisada: cambiar `version` (y la fecha en types.ts).
import { BROKERAGE, SUPPORT_EMAIL } from "@/config/brokerage";
import { PRICING_TIERS, formatPrice, type PricingTierId } from "@/lib/pricing-tiers";
import { PRIVACY_LAST_UPDATED, TERMS_LAST_UPDATED } from "./types";

export interface LegalDocMeta {
  /** Ruta sin idioma: /[lang]{path}. */
  path: string;
  /** Versión que se guarda con cada aceptación (terms_acceptances.version). */
  version: string;
  /** YYYY-MM-DD: "Última actualización". */
  updated: string;
}

export const LEGAL_DOCS = {
  terms: { path: "/terms", version: "2026-10-18-v1", updated: TERMS_LAST_UPDATED },
  privacy: { path: "/privacy", version: "2026-10-18-v1", updated: PRIVACY_LAST_UPDATED },
} as const satisfies Record<string, LegalDocMeta>;

/** {fee} y {pct} del plan, tal como los muestra el sitio ("$199", "0.5%"). */
export function planConsentVars(tier: PricingTierId): { fee: string; pct: string } {
  const t = PRICING_TIERS[tier];
  return { fee: formatPrice(t.flatFee), pct: `${t.commissionPct}%` };
}

/** Marcadores de los textos de consentimiento. {fee}/{pct} solo si se pasa el plan. */
export function fillLegalCopy(text: string, vars?: { fee: string; pct: string }): string {
  let out = text
    .replaceAll("{legalName}", BROKERAGE.legalName)
    .replaceAll("{supportEmail}", SUPPORT_EMAIL);
  if (vars) out = out.replaceAll("{fee}", vars.fee).replaceAll("{pct}", vars.pct);
  return out;
}

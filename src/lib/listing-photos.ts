// Regla de fotos del paso 5, en UN lugar (servidor, contador y textos la leen de aquí).
//   - Essentials: el vendedor sube sus fotos; mínimo MIN_OWN_PHOTOS.
//   - Pro / Concierge: incluyen fotografía profesional; las fotos propias son opcionales.
import { PRICING_TIERS, isPricingTierId } from "@/lib/pricing-tiers";

export const MIN_OWN_PHOTOS = 10;

/** ¿Este plan exige que el vendedor suba sus propias fotos? (sin plan: sí). */
export function ownPhotosRequired(tier: string | null | undefined): boolean {
  return !(tier && isPricingTierId(tier) && PRICING_TIERS[tier].includesPhotography);
}

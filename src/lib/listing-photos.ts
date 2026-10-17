// Regla de fotos del paso 5, en UN lugar (servidor, contador y textos la leen de aquí).
//   - Essentials: el vendedor sube sus fotos; mínimo MIN_OWN_PHOTOS.
//   - Pro / Concierge: incluyen fotografía profesional; las fotos propias son opcionales.
//   - Essentials con el extra de fotografía PAGADO: igual que Pro (decisión 2026-10-16).
import { PRICING_TIERS, isPricingTierId } from "@/lib/pricing-tiers";

export const MIN_OWN_PHOTOS = 10;

/**
 * ¿El vendedor tiene que subir sus propias fotos? Sí, salvo que el plan incluya fotografía
 * profesional o que haya pagado el extra de fotografía (sin plan: sí).
 */
export function ownPhotosRequired(tier: string | null | undefined, photographyPaid = false): boolean {
  if (photographyPaid) return false;
  return !(tier && isPricingTierId(tier) && PRICING_TIERS[tier].includesPhotography);
}

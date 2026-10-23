// Regla de fotos del paso 5, en UN lugar (servidor, contador y textos la leen de aquí).
//   - Essentials: el vendedor sube sus fotos; mínimo MIN_OWN_PHOTOS.
//   - Pro / Concierge: incluyen fotografía profesional; el vendedor sube al menos
//     MIN_FRONT_PHOTOS (la del frente) y el fotógrafo toma el resto. El MLS exige cargar el
//     listing dentro de 2 días hábiles desde la vigencia del acuerdo, con al menos una foto
//     del frente (SEFMLS §15.1.1 y §15.1.12): no se espera a la sesión profesional.
//   - Essentials con el extra de fotografía PAGADO: igual que Pro (decisión 2026-10-16).
import { PRICING_TIERS, isPricingTierId } from "@/lib/pricing-tiers";

export const MIN_OWN_PHOTOS = 10;

/** Fotos mínimas con fotografía profesional: la del frente de la casa (SEFMLS §15.1.12). */
export const MIN_FRONT_PHOTOS = 1;

/**
 * ¿El vendedor tiene que subir sus propias fotos? Sí, salvo que el plan incluya fotografía
 * profesional o que haya pagado el extra de fotografía (sin plan: sí).
 */
export function ownPhotosRequired(tier: string | null | undefined, photographyPaid = false): boolean {
  if (photographyPaid) return false;
  return !(tier && isPricingTierId(tier) && PRICING_TIERS[tier].includesPhotography);
}

/** Fotos que el vendedor tiene que subir antes de pasar del paso 5. Nunca 0. */
export function minPhotos(tier: string | null | undefined, photographyPaid = false): number {
  return ownPhotosRequired(tier, photographyPaid) ? MIN_OWN_PHOTOS : MIN_FRONT_PHOTOS;
}

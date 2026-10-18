// "Planes desde…": la tarifa fija más baja y la comisión de Lixtara más baja de los planes,
// calculadas desde src/lib/pricing-tiers.ts. Nunca se escriben a mano en el hero ni en la
// landing de propietarios (/owners).

import { PRICING_TIERS, TIER_ORDER, formatPrice } from "@/lib/pricing-tiers";

export function minFlatFee(): number {
  return Math.min(...TIER_ORDER.map((id) => PRICING_TIERS[id].flatFee));
}

export function minCommissionPct(): number {
  return Math.min(...TIER_ORDER.map((id) => PRICING_TIERS[id].commissionPct));
}

/** Reemplaza {minFee} ("$199") y {minPct} ("0.5%", decimal con punto). */
export function fillFromPricing(text: string): string {
  return text.replaceAll("{minFee}", formatPrice(minFlatFee())).replaceAll("{minPct}", `${minCommissionPct()}%`);
}

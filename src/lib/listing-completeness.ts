// Primer paso incompleto del flujo del vendedor (pasos 1–6), con las mismas reglas que los
// server actions de cada paso. La página redirige ahí si la URL pide un paso posterior
// (?step=7 con los pasos 2–6 vacíos) y /api/agreement/create rechaza un listing incompleto.
import { isPricingTierId } from "@/lib/pricing-tiers";
import { minPhotos } from "@/lib/listing-photos";
import { offerFromRow, type BuyerCompRow } from "@/lib/buyer-comp";
import { isFinancingTerm } from "@/lib/financing-terms";

export const PROPERTY_TYPES = ["single_family", "condo", "townhouse", "multi_family"] as const;

export interface ListingCompletenessFacts {
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  pricing_tier: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  year_built: number | null;
  list_price: number | null;
  /** Financing accepted (line 23 of the agreement): at least one, since migration 20261021120000. */
  financing_terms: string[] | null;
  description: string | null;
  photos_rights_confirmed: boolean | null;
  photoCount: number;
  photographyPaid: boolean;
  buyerComp: BuyerCompRow | null;
}

const filled = (v: string | null | undefined) => (v ?? "").trim().length > 0;
const inRange = (v: number | null | undefined, min: number, max: number, minExclusive = false) =>
  typeof v === "number" && Number.isFinite(v) && (minExclusive ? v > min : v >= min) && v <= max;

/** ¿Está completo el paso `step` (1–6)? Las reglas reflejan la validación de su server action. */
export function stepComplete(step: number, f: ListingCompletenessFacts, now = new Date()): boolean {
  switch (step) {
    case 1:
      return filled(f.address_street) && filled(f.address_city) && filled(f.address_zip);
    case 2:
      return !!f.pricing_tier && isPricingTierId(f.pricing_tier);
    case 3:
      return (
        PROPERTY_TYPES.includes(f.property_type as (typeof PROPERTY_TYPES)[number]) &&
        inRange(f.bedrooms, 0, 30) &&
        inRange(f.bathrooms, 0, 30, true) &&
        inRange(f.sqft, 0, 100000, true) &&
        inRange(f.year_built, 1800, now.getFullYear() + 2) &&
        inRange(f.list_price, 0, 1000000000, true) &&
        (f.financing_terms ?? []).some(isFinancingTerm)
      );
    case 4:
      return (f.description ?? "").trim().length >= 10;
    case 5: {
      // Todos los planes: al menos minPhotos (10 propias, o la del frente con fotografía
      // profesional) y los derechos confirmados al continuar.
      return f.photoCount >= minPhotos(f.pricing_tier, f.photographyPaid) && f.photos_rights_confirmed === true;
    }
    case 6:
      // 0% ("none") es una elección válida; sin elección, no.
      return offerFromRow(f.buyerComp) !== null;
    default:
      return true;
  }
}

/** Primer paso de 1 a 6 sin completar, o null si los seis están completos. */
export function firstIncompleteStep(f: ListingCompletenessFacts, now = new Date()): number | null {
  for (let step = 1; step <= 6; step++) {
    if (!stepComplete(step, f, now)) return step;
  }
  return null;
}

/** Paso que se muestra: el pedido, salvo que haya uno anterior incompleto. */
export function allowedStep(requested: number, firstIncomplete: number | null): number {
  return firstIncomplete !== null && requested > firstIncomplete ? firstIncomplete : requested;
}

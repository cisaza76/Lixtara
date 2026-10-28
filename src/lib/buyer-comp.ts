// Oferta de compensación al agente del comprador (paso 6). Pura: la usan el paso 6, el
// desglose de costos, la calculadora, el acuerdo de DocuSign y los tests.
//
// Tres formas: ninguna (0%), un porcentaje del precio de venta o un monto fijo en USD. Es
// aparte de la comisión de Lixtara y no se publica en el MLS (src/config/legal-terms.ts).
// En la base: properties.buyer_agent_comp_type + buyer_agent_commission (%) +
// buyer_agent_comp_amount (USD), migración 20261017150000.

import { parseFormNumber } from "@/lib/form-numbers";
import {
  PRICING_TIERS,
  TRADITIONAL_COSTS,
  tierCostBreakdown,
  type PricingTierId,
} from "@/lib/pricing-tiers";

export type BuyerCompOffer =
  | { type: "none" }
  | { type: "percent"; pct: number }
  | { type: "amount"; amount: number };

export type BuyerCompType = BuyerCompOffer["type"];

/** Opciones fijas del paso 6 y de la calculadora, además de 0% y Personalizado. */
export const BUYER_COMP_PRESET_PCTS = [2, 2.5, 3] as const;

/** Punto de partida de Concierge (sugerido por la broker; el vendedor lo cambia). */
export const CONCIERGE_SUGGESTED_PCT = 3;

/**
 * Tope de la compensación personalizada: más de 0 y hasta 3% (porcentaje), o un monto fijo
 * de hasta el 3% del precio de lista. Es una regla de Lixtara, no una ley ni una regla del
 * MLS (decisión del owner 2026-10-17). La base lo refuerza para el % (migración
 * 20261017200000); el monto depende del precio, así que lo valida el servidor.
 */
export const BUYER_COMP_MAX_PCT = 3;

/** Monto fijo máximo para ese precio de lista (USD, con centavos). */
export function buyerCompMaxAmount(listPrice: number | null | undefined): number {
  const price = Number(listPrice ?? 0);
  return price > 0 ? Math.floor(price * BUYER_COMP_MAX_PCT) / 100 : 0;
}

/** La oferta guardada respeta el tope con el precio de lista actual (0% siempre). */
export function offerWithinLimit(offer: BuyerCompOffer, listPrice: number | null | undefined): boolean {
  if (offer.type === "none") return true;
  if (offer.type === "percent") return offer.pct > 0 && offer.pct <= BUYER_COMP_MAX_PCT;
  return offer.amount > 0 && offer.amount <= buyerCompMaxAmount(listPrice);
}

export const NO_OFFER: BuyerCompOffer = { type: "none" };

export interface BuyerCompRow {
  buyer_agent_comp_type: string | null;
  buyer_agent_commission: number | string | null;
  buyer_agent_comp_amount: number | string | null;
}

/** Oferta guardada, o null si el vendedor todavía no eligió (sin preselección). */
export function offerFromRow(row: BuyerCompRow | null | undefined): BuyerCompOffer | null {
  if (!row) return null;
  const pct = Number(row.buyer_agent_commission ?? 0);
  const amount = Number(row.buyer_agent_comp_amount ?? 0);
  switch (row.buyer_agent_comp_type) {
    case "none":
      return NO_OFFER;
    case "percent":
      return pct > 0 ? { type: "percent", pct } : null;
    case "amount":
      return amount > 0 ? { type: "amount", amount } : null;
    default:
      // Filas anteriores a la migración: el selector viejo solo guardaba 2, 2.5 o 3 (la
      // migración hace el mismo relleno). 0 sin tipo = el vendedor todavía no eligió.
      return pct > 0 && pct <= BUYER_COMP_MAX_PCT ? { type: "percent", pct } : null;
  }
}

/** Columnas de properties para una oferta (las tres siempre, para no dejar restos). */
export function offerToRow(offer: BuyerCompOffer) {
  return {
    buyer_agent_comp_type: offer.type,
    buyer_agent_commission: offer.type === "percent" ? offer.pct : 0,
    buyer_agent_comp_amount: offer.type === "amount" ? offer.amount : null,
  };
}

/** Preselección: solo Concierge (3%). Essentials y Pro empiezan sin nada elegido. */
export function suggestedOffer(tier: string | null | undefined): BuyerCompOffer | null {
  return tier === "concierge" ? { type: "percent", pct: CONCIERGE_SUGGESTED_PCT } : null;
}

export type OfferInputError = "choice_required" | "pct_range" | "pct_max" | "amount_range" | "amount_max";

/**
 * Lee el formulario del paso 6. `choice`: "0" | "2" | "2.5" | "3" | "custom".
 * Personalizado: `custom_kind` "percent" (0 < % ≤ 3) o "amount" (0 < USD ≤ 3% del precio de lista).
 */
export function parseOfferInput(
  input: { choice?: string | null; customKind?: string | null; customValue?: string | null },
  listPrice: number | null | undefined,
): { ok: true; offer: BuyerCompOffer } | { ok: false; error: OfferInputError } {
  const choice = (input.choice ?? "").trim();
  if (!choice) return { ok: false, error: "choice_required" };
  if (choice === "0") return { ok: true, offer: NO_OFFER };
  const preset = BUYER_COMP_PRESET_PCTS.find((p) => String(p) === choice);
  if (preset !== undefined) return { ok: true, offer: { type: "percent", pct: preset } };
  if (choice !== "custom") return { ok: false, error: "choice_required" };

  if (input.customKind === "amount") {
    // Coma de miles bien agrupada y "$" (parseFormNumber): antes se quitaban TODAS las comas y
    // "5,00" se leía como 500.
    const parsed = parseFormNumber(input.customValue, "money");
    const value = parsed.ok && parsed.value !== null ? parsed.value : NaN;
    const max = buyerCompMaxAmount(listPrice);
    if (!Number.isFinite(value) || value <= 0 || !(max > 0)) return { ok: false, error: "amount_range" };
    if (value > max) return { ok: false, error: "amount_max" };
    return { ok: true, offer: { type: "amount", amount: Math.round(value * 100) / 100 } };
  }
  if (input.customKind === "percent") {
    const raw = (input.customValue ?? "").trim().replace(/[$\s%]/g, "");
    const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    // Una coma en un porcentaje no es separador de miles: "2,5" no se lee como 25%.
    if ((input.customValue ?? "").includes(",")) return { ok: false, error: "pct_range" };
    // numeric(4,2) en la base: dos decimales.
    const pct = Math.round(value * 100) / 100;
    if (!Number.isFinite(value) || pct <= 0) return { ok: false, error: "pct_range" };
    if (pct > BUYER_COMP_MAX_PCT) return { ok: false, error: "pct_max" };
    return { ok: true, offer: { type: "percent", pct } };
  }
  return { ok: false, error: "choice_required" };
}

/** USD que recibiría el agente del comprador a ese precio de venta. */
export function offerAmountAt(offer: BuyerCompOffer, salePrice: number): number {
  if (offer.type === "percent") return (salePrice * offer.pct) / 100;
  if (offer.type === "amount") return offer.amount;
  return 0;
}

/** "2.5%", "$12,000" o "0%". Decimales con punto en los dos idiomas. */
export function formatOffer(offer: BuyerCompOffer): string {
  if (offer.type === "percent") return `${offer.pct}%`;
  if (offer.type === "amount") return `$${offer.amount.toLocaleString("en-US")}`;
  return "0%";
}

/** Valor del radio del paso 6 para una oferta guardada. */
export function offerChoice(offer: BuyerCompOffer | null): string {
  if (!offer) return "";
  if (offer.type === "none") return "0";
  if (offer.type === "percent" && (BUYER_COMP_PRESET_PCTS as readonly number[]).includes(offer.pct)) {
    return String(offer.pct);
  }
  return "custom";
}

/**
 * Lixtara frente a un agente tradicional con la MISMA compensación al agente del comprador
 * en los dos lados (la regla de compareWithTraditional), para porcentaje, monto fijo o 0%.
 */
export function compareWithOffer(tierId: PricingTierId, salePrice: number, offer: BuyerCompOffer) {
  const base = tierCostBreakdown(tierId, salePrice, 0);
  const buyerCompensation = offerAmountAt(offer, salePrice);
  const lixtaraTotal = base.upfront + base.sellerCommission + buyerCompensation;
  const listingCommission = (salePrice * TRADITIONAL_COSTS.listingCommissionPct) / 100;
  const traditionalTotal = listingCommission + buyerCompensation;
  return {
    flatFee: PRICING_TIERS[tierId].flatFee,
    lixtaraCommission: base.sellerCommission,
    buyerCompensation,
    lixtaraTotal,
    traditionalListingCommission: listingCommission,
    traditionalTotal,
    savings: traditionalTotal - lixtaraTotal,
  };
}

/**
 * CASSB-1 apagado hasta nuevo aviso (decisión del owner, 2026-10-18). Con false, el código no
 * genera ni sugiere el CASSB-1: cassb1Tabs() devuelve null, el admin no lo menciona y la hoja
 * de Matrix tampoco.
 *
 * Coherencia con el acuerdo de listado (2026-10-21): el ERS-21tn marca 10(b), así que el
 * acuerdo aparte es entre el VENDEDOR y el broker del comprador. El CASSB-1 ("Seller or
 * Seller's Broker to Buyer's Broker") lo cubre marcando "Seller" en el párrafo 1 y "Property is
 * listed by Seller's Broker, Lixtara LLC" en el párrafo 2: eso arma cassb1Tabs. Antes de
 * encenderlo, la plantilla tiene que nombrar las casillas de la compensación (hoy sin nombre).
 */
export const CASSB1_ENABLED = false;

/**
 * Acuerdos de compensación (CASSB-1) que corresponden a la oferta: ninguno con 0%, uno con
 * cualquier oferta mayor que 0. El CASSB-1 se firma con el agente del comprador concreto
 * (su nombre y su broker son campos del formulario), así que lo prepara la broker cuando
 * un agente lo solicita; esta función decide si existe.
 */
export function compensationAgreementsFor(offer: BuyerCompOffer | null): 0 | 1 {
  return !offer || offer.type === "none" ? 0 : 1;
}

/**
 * Opción del párrafo 10 del acuerdo de listado (ERS-21tn), excluyentes. El modelo de Lixtara:
 * el vendedor paga al broker del comprador, aparte de la comisión de Lixtara → 10(b), con el %
 * o el monto en la línea 150. Con 0% → 10(c). Nunca 10(a), que la saca de la comisión del
 * Broker (decisión del owner, 2026-10-21).
 */
export function buyerCompOption(offer: BuyerCompOffer): "b" | "c" {
  return compensationAgreementsFor(offer) === 1 ? "b" : "c";
}

export interface Cassb1Tabs {
  text: Record<string, string>;
  checkbox: Record<string, boolean>;
}

/**
 * Campos del CASSB-1 para una oferta > 0, coherentes con el 10(b) del acuerdo de listado:
 * paga el vendedor (párrafo 1), la propiedad está listada por Lixtara (párrafo 2), y
 * `fee_amount` = monto fijo en USD o `fee_pct_value` = % del precio de compra. Sin "$" ni "%"
 * (los imprime el formulario). null con 0%.
 */
export function cassb1Fields(offer: BuyerCompOffer | null, sellerName: string, listingBroker: string): Cassb1Tabs | null {
  if (!offer || compensationAgreementsFor(offer) === 0) return null;
  const fee: Record<string, string> =
    offer.type === "amount" ? { fee_amount: offer.amount.toLocaleString("en-US") } : offer.type === "percent" ? { fee_pct_value: String(offer.pct) } : {};
  return {
    text: { seller_name: sellerName, listing_broker_name: listingBroker, ...fee },
    checkbox: { party_seller: true, party_sellers_broker: false, property_listed: true, property_not_listed: false },
  };
}

/** cassb1Fields, solo con el CASSB-1 encendido (CASSB1_ENABLED). */
export function cassb1Tabs(offer: BuyerCompOffer | null, sellerName: string, listingBroker: string): Cassb1Tabs | null {
  if (!CASSB1_ENABLED) return null;
  return cassb1Fields(offer, sellerName, listingBroker);
}

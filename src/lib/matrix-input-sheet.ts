// Ficha de carga para Matrix (MIAMI MLS) a partir de un listing PROPIO.
//
// MIAMI no ofrece API de carga de listings (Benjamin Costa, 2026-10-10: solo los input
// sheets). La broker da de alta cada listing a mano en Matrix; esta ficha le pone los datos
// que Lixtara ya tiene en el orden y con los nombres de campo de los formularios oficiales
// "SEF RE1" (single family) y "SEF RE2" (condo / townhouse), revisión 08/2024:
// https://www.miamirealtors.com/mls/mls-forms/
//
// Solo se rellena lo que Lixtara sabe de verdad. Lo que exige criterio de la broker (Area,
// Listing Type, código de estilo exacto…) sale vacío o marcado `verify`, nunca adivinado.
//
// PURO: sin I/O.

import { BROKERAGE } from "@/config/brokerage";
import { PRICING_TIERS, isPricingTierId } from "@/lib/pricing-tiers";
import type { ApplianceKey } from "@/lib/appliances";

export interface MatrixSourceProperty {
  address_street: string;
  address_city: string;
  address_state: string | null;
  address_zip: string;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lot_size: number | null;
  year_built: number | null;
  list_price: number | null;
  description: string | null;
  showing_instructions: string | null;
  occupancy_status: string | null;
  folio: string | null;
  legal_description: string | null;
  parking_spaces: number | null;
  hoa_fee: number | null;
  tax_annual_amount: number | null;
  has_pool: boolean | null;
  cash_only: boolean | null;
  as_is_sale: boolean | null;
  flood_zone: string | null;
  appliances: string[] | null;
  pricing_tier: string | null;
  mls_published_at: string | null;
  buyer_agent_commission: number | null;
}

export interface MatrixSourcePhoto {
  url: string;
  is_primary: boolean | null;
}

export interface MatrixRow {
  /** Nombre del campo tal como aparece en el input sheet / Matrix. */
  label: string;
  /** Valor para copiar. `null` = la broker lo completa en Matrix. */
  value: string | null;
  /** Aclaración para la broker (de dónde sale, o qué decidir). */
  hint?: string;
  /** Sugerencia que la broker debe confirmar antes de copiar. */
  verify?: boolean;
}

export interface MatrixSection {
  title: string;
  rows: MatrixRow[];
}

export type MatrixForm = "RE1" | "RE2";

export interface MatrixInputSheet {
  form: MatrixForm;
  formName: string;
  sections: MatrixSection[];
  photos: string[];
}

/** Límites de caracteres impresos en el input sheet (SEF RE1/RE2, 08/2024). */
export const MATRIX_REMARKS_MAX = 800;
export const MATRIX_DIRECTIONS_MAX = 255;

/** Casas → RE1. Condo y townhouse → RE2. Multifamiliar no tiene ficha aquí (es RIN). */
export function matrixFormFor(propertyType: string | null): MatrixForm | null {
  if (propertyType === "single_family") return "RE1";
  if (propertyType === "condo" || propertyType === "townhouse") return "RE2";
  return null;
}

const COMPASS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const STREET_TYPES = new Set([
  "ST", "AVE", "AV", "RD", "DR", "CT", "LN", "TER", "PL", "BLVD", "WAY", "CIR", "PKWY",
  "HWY", "TRL", "CV", "PATH", "LOOP", "SQ", "PT", "XING", "RUN", "ROW",
]);
const UNIT_MARKERS = /\s+(?:APT|UNIT|STE|SUITE|#)\s*\.?\s*#?\s*([A-Z0-9-]+)\s*$/i;

export interface ParsedStreet {
  number: string | null;
  compass: string | null;
  name: string;
  type: string | null;
  unit: string | null;
}

/**
 * "1234 NW 5th St Apt 2" → número, punto cardinal, nombre, tipo y unidad, que en Matrix
 * son campos separados. Tolerante: lo que no reconoce se queda en `name`.
 */
export function parseStreet(street: string): ParsedStreet {
  let rest = street.trim().replace(/\s+/g, " ").replace(/,$/, "");
  let unit: string | null = null;
  const u = rest.match(UNIT_MARKERS);
  if (u) {
    unit = u[1].toUpperCase();
    rest = rest.slice(0, u.index).trim().replace(/,$/, "");
  }
  const tokens = rest.split(" ");
  let number: string | null = null;
  if (tokens.length > 1 && /^\d+[A-Z]?$/i.test(tokens[0])) number = tokens.shift()!;
  let compass: string | null = null;
  if (tokens.length > 1 && COMPASS.has(tokens[0].replace(/\./g, "").toUpperCase())) {
    compass = tokens.shift()!.replace(/\./g, "").toUpperCase();
  }
  let type: string | null = null;
  const last = tokens.at(-1)?.replace(/\./g, "").toUpperCase();
  if (tokens.length > 1 && last && STREET_TYPES.has(last)) {
    tokens.pop();
    type = last === "AV" ? "AVE" : last;
  }
  return { number, compass, name: tokens.join(" "), type, unit };
}

/** 2.5 → 2 completos + 1 medio. Matrix los pide por separado. */
export function splitBaths(bathrooms: number | null): { full: number; half: number } | null {
  if (bathrooms === null || !Number.isFinite(bathrooms) || bathrooms < 0) return null;
  const full = Math.floor(bathrooms);
  return { full, half: bathrooms - full >= 0.5 ? 1 : 0 };
}

/** Valores de la lista "Equipment / Appliances" del input sheet. */
const APPLIANCE_TO_MATRIX: Record<ApplianceKey, string | null> = {
  refrigerator: "Refrigerator",
  range_oven: "Electric Range", // o Gas Range: se marca verify
  microwave: "Microwave",
  dishwasher: "Dishwasher",
  garbage_disposal: "Disposal",
  washer: "Washer",
  dryer: "Dryer",
  water_heater: "Electric Water Heater", // o Gas Water Heater: se marca verify
  water_softener: "Water Softener / Filter Owned",
  garage_door_opener: "Auto Garage Door Opener",
  ceiling_fans: null, // campo propio: # Ceiling Fans
  window_treatments: null, // campo propio: Window Treatments
};

const OCCUPANCY: Record<string, string> = {
  vacant: "Vacant",
  owner_occupied: "Owner Occupied",
  tenant_occupied: "Tenant Occupied",
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (n: number | null) => (n === null ? null : String(n));
const yesNo = (b: boolean | null) => (b === null ? null : b ? "Yes" : "No");

function addMonths(iso: string, months: number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  // Último día del mes si el día no existe (31 ene + 1 mes → 28/29 feb).
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

function mmddyyyy(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function styleRow(p: MatrixSourceProperty, form: MatrixForm): MatrixRow {
  if (form === "RE1") {
    return p.has_pool
      ? { label: "Style", value: "R31 POOL ONLY", verify: true, hint: "If waterfront: R33 (WF/POOL/NO AC) or R35 (WF/POOL/OCN AC)." }
      : { label: "Style", value: "R30 NO POOL/NO WATER", verify: true, hint: "If waterfront: R32 (WF/NO OCEAN AC) or R34 (WF/OCEAN AC)." };
  }
  if (p.property_type === "townhouse") {
    return { label: "Style", value: null, hint: "T51 Townhouse Fee Simple or T52 Townhouse Condo." };
  }
  return {
    label: "Style",
    value: null,
    hint: "C41 Condo 1-4 stories · C42 Condo 5+ stories · C43 Condo-hotel · C44/C45 Co-op · C40 Efficiency.",
  };
}

/** `null` si el tipo de inmueble no tiene ficha RE1/RE2 (multifamiliar → RIN). */
export function buildMatrixInputSheet(
  p: MatrixSourceProperty,
  photos: MatrixSourcePhoto[],
): MatrixInputSheet | null {
  const form = matrixFormFor(p.property_type);
  if (!form) return null;

  const street = parseStreet(p.address_street);
  const baths = splitBaths(p.bathrooms);
  const appliances = (p.appliances ?? []) as ApplianceKey[];
  const equipment = appliances
    .map((a) => APPLIANCE_TO_MATRIX[a])
    .filter((v): v is string => typeof v === "string");
  const equipmentNeedsGasCheck = appliances.includes("range_oven") || appliances.includes("water_heater");

  const termMonths = isPricingTierId(p.pricing_tier) ? PRICING_TIERS[p.pricing_tier].termMonths : null;
  const listDate = p.mls_published_at ? p.mls_published_at.slice(0, 10) : null;
  const expiration = listDate && termMonths ? addMonths(listDate, termMonths) : null;

  const remarks = p.description?.trim() || null;
  const remarksHint =
    remarks && remarks.length > MATRIX_REMARKS_MAX
      ? `Too long for Matrix: ${remarks.length}/${MATRIX_REMARKS_MAX} characters. Shorten before pasting.`
      : remarks
        ? `${remarks.length}/${MATRIX_REMARKS_MAX} characters.`
        : undefined;

  const terms: string[] = [];
  if (p.cash_only) terms.push("Cash");
  const special: string[] = [];
  if (p.as_is_sale) special.push("As Is");

  const location: MatrixRow[] = [
    { label: "Area", value: null, hint: "MLS area code (see Matrix table)." },
    { label: "Street Number", value: street.number },
    { label: "CP (Compass Point)", value: street.compass },
    { label: "Street Name", value: street.name },
    { label: "Street Type", value: street.type },
    ...(form === "RE2" || street.unit ? [{ label: "Unit #", value: street.unit } satisfies MatrixRow] : []),
    { label: "City", value: p.address_city },
    { label: "State", value: p.address_state || "FL" },
    { label: "Zip Code", value: p.address_zip },
    {
      label: "Folio #",
      value: p.folio,
      hint: "Matrix auto-fills street, county, legal, year built, SqFt and taxes from the Folio (Miami-Dade, Broward, Palm Beach).",
    },
    { label: "Legal", value: p.legal_description },
  ];
  if (form === "RE2") {
    location.push(
      { label: "Complex Name", value: null },
      { label: "Unit Floor Location", value: null },
    );
  }

  const sections: MatrixSection[] = [
    { title: "General information", rows: location },
    {
      title: "Price",
      rows: [{ label: "List Price", value: p.list_price ? money(p.list_price) : null }],
    },
    {
      title: "Property",
      rows: [
        styleRow(p, form),
        { label: "Year Built", value: num(p.year_built) },
        { label: "SqFt (living area)", value: num(p.sqft) },
        ...(form === "RE1"
          ? [{ label: "Lot Sqft", value: num(p.lot_size), hint: "From the seller; check against the Folio." } satisfies MatrixRow]
          : []),
        { label: "# Beds", value: num(p.bedrooms) },
        { label: "# Full Baths", value: baths ? String(baths.full) : null },
        { label: "# Half Baths", value: baths ? String(baths.half) : null },
        {
          label: form === "RE1" ? "Garage Spaces" : "Parking Description",
          value: num(p.parking_spaces),
          verify: p.parking_spaces !== null,
          hint: "Lixtara stores total parking spaces; split garage / carport in Matrix.",
        },
        { label: form === "RE1" ? "Pool YN" : "Pool", value: yesNo(p.has_pool) },
      ],
    },
    {
      title: "Features",
      rows: [
        {
          label: "Equipment / Appliances",
          value: equipment.length ? equipment.join(", ") : null,
          verify: equipmentNeedsGasCheck,
          hint: equipmentNeedsGasCheck ? "Confirm electric vs gas for range and water heater." : undefined,
        },
        ...(appliances.includes("ceiling_fans")
          ? [{ label: "# Ceiling Fans", value: null, hint: "Seller includes ceiling fans; enter the count." } satisfies MatrixRow]
          : []),
        ...(appliances.includes("window_treatments")
          ? [{ label: "Window Treatments", value: null, hint: "Seller includes window treatments; pick the type." } satisfies MatrixRow]
          : []),
      ],
    },
    {
      title: "Remarks",
      rows: [
        { label: "Remarks", value: remarks, hint: remarksHint },
        { label: "Directions", value: null, hint: `Max ${MATRIX_DIRECTIONS_MAX} characters.` },
      ],
    },
    {
      title: "Financial",
      rows: [
        { label: "Tax Amount", value: p.tax_annual_amount ? money(p.tax_annual_amount) : null },
        { label: "Tax Year", value: null },
        {
          label: form === "RE1" ? "Assoc. Fee" : "Maintenance Fee",
          value: p.hoa_fee ? money(p.hoa_fee) : null,
          hint: p.hoa_fee ? "Monthly, as entered by the seller." : undefined,
        },
        ...(form === "RE1"
          ? [{ label: "Type of Assoc.", value: p.hoa_fee ? null : "None", hint: p.hoa_fee ? "Home Owners, Condo or Other." : undefined } satisfies MatrixRow]
          : []),
        { label: "Flood Zone", value: p.flood_zone },
        { label: "Terms Considered", value: terms.length ? terms.join(", ") : null },
        { label: "Special Information", value: special.length ? special.join(", ") : null },
      ],
    },
    {
      title: "Listing & showing",
      rows: [
        { label: "Listing Type", value: null, hint: "Broker decides (e.g. Exclusive Right To Sell, Limited Service)." },
        { label: "List Date", value: listDate ? mmddyyyy(listDate) : null },
        {
          label: "Expiration Date",
          value: expiration ? mmddyyyy(expiration) : null,
          hint: termMonths ? `${termMonths} months after List Date (Lixtara listing term).` : undefined,
        },
        { label: "Occupancy Info.", value: p.occupancy_status ? (OCCUPANCY[p.occupancy_status] ?? null) : null },
        {
          label: "Showing Instructions",
          value: p.showing_instructions?.trim() || null,
          verify: !!p.showing_instructions?.trim(),
          hint: "Seller's own words. Pick up to 3 Matrix options (e.g. Call Listing Agent, Appointment Only).",
        },
        { label: "Office Name", value: BROKERAGE.legalName },
        { label: "Agent Name", value: BROKERAGE.brokerName },
        {
          label: "Buyer-agent compensation",
          value: null,
          hint:
            p.buyer_agent_commission
              ? `Seller offered ${p.buyer_agent_commission}%. Not an MLS field since the 2024 NAR settlement; handle outside the MLS.`
              : "Not an MLS field since the 2024 NAR settlement.",
        },
      ],
    },
  ];

  const ordered = [...photos].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
  return {
    form,
    formName: form === "RE1" ? "SEF RE1 · Single Family" : "SEF RE2 · Condo / Townhouse",
    sections,
    photos: ordered.map((ph) => ph.url),
  };
}

/** Todo en texto plano, una línea por campo, para el botón "Copy all". */
export function matrixSheetToText(sheet: MatrixInputSheet): string {
  const out: string[] = [`MIAMI MLS ${sheet.formName}`];
  for (const s of sheet.sections) {
    out.push("", s.title.toUpperCase());
    for (const r of s.rows) out.push(`${r.label}: ${r.value ?? ""}`);
  }
  if (sheet.photos.length) {
    out.push("", `PHOTOS (${sheet.photos.length}, primary first)`, ...sheet.photos);
  }
  return out.join("\n");
}

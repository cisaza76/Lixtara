// Miami-Dade County Property Appraiser lookup.
// Public, free, no API key. Used by the listing form Step 3 to autofill
// bedrooms/bathrooms/sqft/year_built/lot_size/property_type from official
// county records.
//
// Two endpoints used:
//   1. GetAddress — finds the folio number from a street + zip.
//   2. GetPropertySearchByFolio — fetches building + lot details by folio.

const MD_PA_BASE =
  "https://apps.miamidadepa.gov/PApublicServiceProxy/PaServicesProxy.ashx";

export interface MiamiDadeDetails {
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lot_size: number | null;
  year_built: number | null;
  property_type: string | null;
  /** Full county legal description (used to auto-fill the listing agreement) */
  legal_description: string | null;
  /**
   * ESTIMATED annual property tax (USD), derived from the county's most recent
   * taxable value × an aggregate Miami-Dade millage (~2%). The Property
   * Appraiser exposes taxable value but not the actual tax bill (that lives in
   * the Cloudflare-gated Tax Collector). Mirrors the PA site's "estimated
   * taxes" — always shown to the seller as an estimate to verify and edit.
   */
  tax_annual_amount: number | null;
}

// Aggregate Miami-Dade millage as a fraction of taxable value (~20 mills).
// The exact rate varies by municipality and year; 2% is the countywide
// approximation the Property Appraiser uses for its own tax estimate. Any
// autofilled value is labeled "estimated" and the seller can correct it.
const MIAMI_DADE_EST_MILLAGE_RATE = 0.02;

// Pull the most-recent-year taxable value from the GetPropertySearchByFolio
// payload, preferring the county taxable value, then the assessed/total value.
function latestTaxableValue(json: Record<string, unknown>): number | null {
  const pickLatest = (
    arr: Array<Record<string, unknown>> | undefined,
    keys: string[],
  ): number | null => {
    if (!arr || arr.length === 0) return null;
    const latest = arr
      .slice()
      .sort((a, b) => Number(b.Year ?? 0) - Number(a.Year ?? 0))[0];
    for (const k of keys) {
      const v = Number(latest?.[k] ?? 0);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  };
  const taxable = (json?.Taxable as Record<string, unknown> | undefined)
    ?.TaxableInfos as Array<Record<string, unknown>> | undefined;
  const assessment = (json?.Assessment as Record<string, unknown> | undefined)
    ?.AssessmentInfos as Array<Record<string, unknown>> | undefined;
  return (
    pickLatest(taxable, ["CountyTaxableValue", "SchoolTaxableValue"]) ??
    pickLatest(assessment, ["AssessedValue", "TotalValue"])
  );
}

export interface MiamiDadeLookupResult {
  found: boolean;
  /** El condado clasifica la parcela como no residencial: no se autollena nada. */
  nonResidential?: boolean;
  /** Multifamiliar de 5 o más unidades: en el MLS es comercial; no se autollena (aviso propio). */
  largeMultifamily?: boolean;
  folio?: string | null;
  details?: MiamiDadeDetails;
  filledFields?: Array<keyof MiamiDadeDetails>;
  error?: string;
}

// Código de uso del condado → property_type. El DORCode de Miami-Dade tiene 4 dígitos: los dos
// primeros son la clase estatal del DOR y los dos últimos el subcódigo del condado
// (verificado contra GetPropertySearchByFolio, 2026-10-17 y 2026-10-27):
//   0101 SINGLE FAMILY : 1 UNIT · 0105 CLUSTER HOME · 0407 CONDOMINIUM - RESIDENTIAL ·
//   0410 TOWNHOUSE · 0508 COOPERATIVE · 0802 MULTIFAMILY 2-9 UNITS : 2 LIVING UNITS ·
//   0803 MULTIFAMILY 2-9 UNITS : 3 OR MORE · 0303 MULTIFAMILY 10+ · 0081 VACANT LAND ·
//   0420 DOCK · 1813 OFFICE BUILDING - MULTISTORY (200 S Biscayne Blvd).
// Regla (2026-10-27): solo se autollena una vivienda — unifamiliar, condominio (y cooperativa),
// townhouse o multifamiliar de 2 a 4 unidades. Cualquier otro código → null = no residencial:
// no se autollena nada (200 S Biscayne, un edificio de oficinas, salía "Single family" con un
// impuesto de $8,100,000).
export type CountyPropertyType = "single_family" | "condo" | "townhouse" | "multi_family";

/** Multifamiliar de 2 a 4 unidades: UnitCount del condado o, si no llegó, el subcódigo 0802. */
function multifamilyUpToFour(code: string, desc: string, unitCount: unknown): boolean {
  const n = Number(unitCount);
  if (Number.isInteger(n) && n > 0) return n >= 2 && n <= 4;
  return code === "0802" || /\b2 LIVING UNITS\b/.test(desc);
}

/**
 * Edificio de 5 o más unidades: clase 03 (10+) o clase 08 con UnitCount ≥ 5. Si el condado no
 * da el número de unidades (0803 "3 OR MORE"), no se sabe: no cuenta.
 */
export function isLargeMultifamily(dor: string | null | undefined, unitCount?: unknown): boolean {
  const code = String(dor ?? "").trim();
  if (!/^\d{4}$/.test(code)) return false;
  if (code.startsWith("03")) return true;
  const n = Number(unitCount);
  return code.startsWith("08") && Number.isInteger(n) && n >= 5;
}

export function mapDorToType(
  dor: string | null | undefined,
  description?: string | null,
  unitCount?: unknown,
): CountyPropertyType | null {
  const code = String(dor ?? "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const desc = String(description ?? "").toUpperCase();
  if (/\b(?:DOCK|VACANT|COMMERCIAL|OFFICE)\b/.test(desc)) return null;
  switch (code.slice(0, 2)) {
    case "01":
      return /\bTOWNHOUSE\b/.test(desc) ? "townhouse" : "single_family";
    case "04":
      // Clase 04 = condominios; 0410 es TOWNHOUSE y 0420 un muelle (DOCK).
      if (code === "0410" || /\bTOWNHOUSE\b/.test(desc)) return "townhouse";
      if (code === "0407" || /\bCONDOMINIUM - RESIDENTIAL\b/.test(desc)) return "condo";
      return null;
    case "05":
      return "condo";
    case "08":
      return multifamilyUpToFour(code, desc, unitCount) ? "multi_family" : null;
    default:
      return null;
  }
}

// Controles del impuesto estimado (regla 2026-10-27): no se autollena si supera cualquiera
// de los dos topes; el vendedor lo escribe y la broker lo verifica.
export const COUNTY_TAX_AUTOFILL_MAX_USD = 200_000;
export const COUNTY_TAX_AUTOFILL_MAX_SHARE_OF_PRICE = 0.05;

/** El impuesto estimado del condado, o null si no pasa los topes. Sin precio de lista (0), solo el tope fijo. */
export function acceptCountyTax(tax: number | null | undefined, listPrice: number | null | undefined): number | null {
  if (tax == null || !Number.isFinite(tax) || tax <= 0) return null;
  if (tax > COUNTY_TAX_AUTOFILL_MAX_USD) return null;
  const price = Number(listPrice ?? 0);
  if (price > 0 && tax > price * COUNTY_TAX_AUTOFILL_MAX_SHARE_OF_PRICE) return null;
  return tax;
}

/**
 * La unidad que el vendedor escribió en el paso 1 (se guarda como "<calle>, Unit <unidad>"),
 * para que la búsqueda del condado tome la parcela de ESA unidad y no otra del edificio.
 */
export function unitFromStoredStreet(street: string): string | null {
  const m = street.match(/(?:\b(?:unit|apt|apartment|suite|ste)\b|#)\s*#?\s*([A-Za-z0-9-]+)\s*$/i);
  return m ? m[1] : null;
}

/** Lo que usamos de cada candidato de GetAddress. */
export interface CountyCandidate {
  Strap?: unknown;
  Folio?: unknown;
  SiteAddress?: unknown;
  SiteUnit?: unknown;
}

// Direccionales escritas completas → la abreviatura que usa el condado. Google Places
// devuelve "10279 Northwest 30th Terrace" y el condado "10279 NW 30 TER" (auditoría #04,
// 2026-10-26: sin esto, "NORTHWEST" se tomaba como nombre de la calle y no había match).
const DIRECTION_WORDS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

function normToken(t: string): string {
  // "6th" → "6", "Ave." → "AVE", "Northwest" → "NW"
  const u = t.toUpperCase().replace(/[.,#]/g, "").replace(/^(\d+)(ST|ND|RD|TH)$/, "$1");
  return DIRECTION_WORDS[u] ?? u;
}

/** Número de casa + primera palabra del nombre de la calle (sin direccionales). */
function streetKey(street: string): { number: string; name: string } | null {
  const tokens = street.trim().split(/\s+/).map(normToken).filter(Boolean);
  const number = tokens[0] ?? "";
  if (!/^\d+[A-Z]?$/.test(number)) return null;
  const DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
  const name = tokens.slice(1).find((t) => !DIRS.has(t)) ?? "";
  return name ? { number, name } : null;
}

function normUnit(u: unknown): string {
  return String(u ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\w)/, "");
}

/**
 * Regla (2026-10-16): el condado devuelve la propiedad más PARECIDA, no la exacta. Con
 * "100 Biscayne Blvd" devolvía 130 Biscayne Blvd (un edificio de oficinas) y con
 * "500 Brickell Ave" el área común del condominio; el autollenado copiaba datos de otra
 * parcela (habitaciones, pies², impuestos y la descripción legal del contrato). Solo se
 * acepta un candidato con el MISMO número de casa y la misma calle, y:
 *   - con unidad escrita: el candidato de esa unidad;
 *   - sin unidad: un único candidato (si hay varios, es un edificio de unidades → ninguno).
 * Sin candidato aceptable → null (el vendedor completa a mano).
 */
export function pickCountyCandidate(
  candidates: CountyCandidate[],
  street: string,
  unit?: string | null,
): string | null {
  const want = streetKey(street);
  if (!want) return null;
  const sameStreet = candidates.filter((c) => {
    const got = streetKey(String(c.SiteAddress ?? ""));
    return got !== null && got.number === want.number && got.name === want.name;
  });
  const wantUnit = normUnit(unit);
  const matches = wantUnit ? sameStreet.filter((c) => normUnit(c.SiteUnit) === wantUnit) : sameStreet;
  if (matches.length !== 1) return null;
  const folio = matches[0].Strap ?? matches[0].Folio;
  return folio ? String(folio).replace(/-/g, "") : null;
}

/**
 * Año de construcción del condado. PropertyInfo.YearBuilt puede venir como texto
 * ("Multiple (See Building Info.)") o "0": entonces se usa el año REAL (`Actual`) más
 * antiguo de los edificios. Regla de Camilo (2026-10-16): un año igual o mayor al actual
 * no se acepta (el vendedor lo escribe si de verdad es construcción nueva).
 */
export function countyYearBuilt(
  yearBuilt: unknown,
  buildings: Array<Record<string, unknown>>,
  currentYear: number,
): number | null {
  const ok = (y: number) => Number.isInteger(y) && y > 1800 && y < currentYear;
  const direct = Number(yearBuilt);
  if (ok(direct)) return direct;
  const actual = buildings.map((b) => Number(b.Actual)).filter(ok);
  return actual.length > 0 ? Math.min(...actual) : null;
}

async function searchByAddress(
  street: string,
  zip: string,
  unit?: string | null,
): Promise<string | null> {
  const url =
    `${MD_PA_BASE}?Operation=GetAddress&clientAppName=PropertySearch` +
    `&from=1&to=20&myAddress=${encodeURIComponent(street)}` +
    // Con unidad, el condado filtra por ella (un edificio puede tener cientos).
    `&myUnit=${encodeURIComponent(unit?.trim() ?? "")}&myCity=&myState=FL&myZipCode=${encodeURIComponent(zip)}` +
    `&RollYear=`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/json",
      "User-Agent": "Mozilla/5.0 (LixtaraListingBot)",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const infos = (json?.MinimumPropertyInfos as CountyCandidate[]) ?? [];
  return pickCountyCandidate(infos, street, unit);
}

async function fetchByFolio(folio: string): Promise<{ details: MiamiDadeDetails; dorCode: string; unitCount: unknown } | null> {
  const url =
    `${MD_PA_BASE}?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch` +
    `&folioNumber=${encodeURIComponent(folio)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/json",
      "User-Agent": "Mozilla/5.0 (LixtaraListingBot)",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const info = (json?.PropertyInfo ?? null) as Record<string, unknown> | null;
  if (!info) return null;

  // Multiple buildings can be returned (additions, prior years). Pick the
  // largest by EffectiveArea — that matches MLS "total sqft" conventions.
  const buildingContainer = (json?.Building ?? {}) as Record<string, unknown>;
  const buildingInfos =
    (buildingContainer.BuildingInfos as Array<Record<string, unknown>>) ?? [];
  const building =
    buildingInfos
      .slice()
      .sort(
        (a, b) =>
          Number(b.EffectiveArea ?? b.HeatedArea ?? 0) -
          Number(a.EffectiveArea ?? a.HeatedArea ?? 0),
      )[0] ?? {};

  const beds = Number(info.BedroomCount ?? 0);
  const fullBaths = Number(info.BathroomCount ?? 0);
  const halfBaths = Number(info.HalfBathroomCount ?? 0);
  const totalBaths = fullBaths + halfBaths * 0.5;

  // EffectiveArea includes heated + adjusted porches/garages — canonical MLS
  // sqft for Miami-Dade. HeatedArea alone undercounts ~10-15%.
  const sqft = Number(
    building.EffectiveArea ??
      info.BuildingEffectiveArea ??
      building.HeatedArea ??
      info.BuildingHeatedArea ??
      0,
  );
  const lot = Number(info.LotSize ?? 0);
  const year = countyYearBuilt(info.YearBuilt, buildingInfos, new Date().getFullYear());

  // Legal description lives at the top level of the response, with "|" between
  // its lines (e.g. "19 53 42 ... | SABAL PALM COURT PB 46-66 | BLOCK 1 | ...").
  // Normalize the separators to newlines so it reads as it does on the county site.
  const legalRaw = (json?.LegalDescription as Record<string, unknown> | undefined)
    ?.Description;
  const legalDescription =
    typeof legalRaw === "string" && legalRaw.trim()
      ? legalRaw.trim().replace(/\s*\|\s*/g, "\n")
      : null;

  // Estimated annual tax from the latest taxable value × aggregate millage.
  const taxableValue = latestTaxableValue(json);
  const taxAnnualEstimate =
    taxableValue != null
      ? Math.round((taxableValue * MIAMI_DADE_EST_MILLAGE_RATE) / 10) * 10
      : null;

  const details: MiamiDadeDetails = {
    bedrooms: beds > 0 && beds < 30 ? beds : null,
    bathrooms: totalBaths > 0 && totalBaths < 30 ? totalBaths : null,
    sqft: sqft > 100 && sqft < 50000 ? Math.round(sqft) : null,
    lot_size: lot > 0 ? lot : null,
    year_built: year,
    property_type: mapDorToType(
      info.DORCode as string | undefined,
      info.DORDescription as string | undefined,
      info.UnitCount,
    ),
    legal_description: legalDescription,
    tax_annual_amount: taxAnnualEstimate,
  };
  return { details, dorCode: String(info.DORCode ?? "").trim(), unitCount: info.UnitCount };
}

// Strip a trailing unit/apt token so county + comps lookups match the building
// (the stored address keeps the unit for contracts/forms).
export function baseStreetForLookup(street: string): string {
  return street
    .replace(/[,\s]*\b(?:unit|apt|apartment|suite|ste|#)\b.*$/i, "")
    .trim();
}

/**
 * Legal description for the listing agreement, VERIFIED against the county at signing time:
 * the stored address is looked up again (same parcel rule as the step-3 autofill, #202) and
 * must resolve to the folio saved on the listing. Anything else (no folio, outside
 * Miami-Dade, county down, another parcel) → null, and the contract says "See Attachment".
 */
export async function verifiedLegalDescription(p: {
  address_street: string | null;
  address_zip: string | null;
  folio: string | null;
}): Promise<string | null> {
  const folio = (p.folio ?? "").replace(/-/g, "").trim();
  if (!folio || !p.address_street || !/^33\d{3}$/.test(p.address_zip ?? "")) return null;
  const r = await lookupMiamiDadeProperty(baseStreetForLookup(p.address_street), p.address_zip!, unitFromStoredStreet(p.address_street));
  if (!r.found || r.folio !== folio) return null;
  return r.details?.legal_description?.trim() || null;
}

export async function lookupMiamiDadeProperty(
  street: string,
  zip: string,
  unit?: string | null,
): Promise<MiamiDadeLookupResult> {
  try {
    if (!street?.trim() || !/^\d{5}$/.test(zip ?? "")) {
      return { found: false, error: "street and 5-digit zip required" };
    }
    const folio = await searchByAddress(street.trim(), zip, unit);
    if (!folio) return { found: false };
    const parcel = await fetchByFolio(folio);
    if (!parcel) return { found: false, folio };
    // Sin código de uso no se sabe qué es: como no encontrada. Con un código que no es
    // vivienda, nada (ni el folio: la descripción legal del contrato sale de ese folio).
    if (!parcel.dorCode) return { found: false };
    if (parcel.details.property_type === null) {
      return isLargeMultifamily(parcel.dorCode, parcel.unitCount)
        ? { found: false, largeMultifamily: true }
        : { found: false, nonResidential: true };
    }
    const details = parcel.details;
    const filled = (Object.keys(details) as Array<keyof MiamiDadeDetails>).filter(
      (k) => details[k] !== null,
    );
    return { found: true, folio, details, filledFields: filled };
  } catch (e) {
    return {
      found: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * Tipo de propiedad que muestra el paso 3. El borrador nace con "single_family" (la columna es
 * NOT NULL), pero ese valor no es un dato: solo se muestra cuando el condado lo confirmó o el
 * vendedor ya guardó el paso 3 (hay pies², habitaciones o año; el condado solo los llena en una
 * vivienda). Si no: con unidad, Condo (decisión del owner 2026-10-17), salvo que el condado diga
 * que la parcela no es residencial; sin unidad, nada — el vendedor elige.
 */
export function step3PropertyTypeDefault(
  draft: {
    property_type: string;
    sqft: number;
    bedrooms: number;
    year_built: number | null;
    address_street: string;
  } | null,
  countyBlocked: boolean,
): string {
  if (!draft) return "";
  const confirmed = draft.sqft > 0 || draft.bedrooms > 0 || draft.year_built != null;
  if (confirmed) return draft.property_type;
  if (countyBlocked) return "";
  return unitFromStoredStreet(draft.address_street) ? "condo" : "";
}

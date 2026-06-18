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
  folio?: string | null;
  details?: MiamiDadeDetails;
  filledFields?: Array<keyof MiamiDadeDetails>;
  error?: string;
}

// Map county DOR use codes to our property_type enum.
// 0001 single family, 0003 multi 2-9, 0004 condo, 0005 coop, 0008 multi 10+,
// 0081 townhouse pud. Others fall through to null.
export function mapDorToType(dor: string | null | undefined): string | null {
  if (!dor) return null;
  const code = String(dor).trim();
  if (code.startsWith("0001")) return "single_family";
  if (code.startsWith("0004") || code.startsWith("0005")) return "condo";
  if (code.startsWith("0081")) return "townhouse";
  if (code.startsWith("0003") || code.startsWith("0008")) return "multi_family";
  return null;
}

async function searchByAddress(
  street: string,
  zip: string,
): Promise<string | null> {
  const url =
    `${MD_PA_BASE}?Operation=GetAddress&clientAppName=PropertySearch` +
    `&from=1&to=1&myAddress=${encodeURIComponent(street)}` +
    `&myUnit=&myCity=&myState=FL&myZipCode=${encodeURIComponent(zip)}` +
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
  const infos =
    (json?.MinimumPropertyInfos as Array<Record<string, unknown>>) ?? [];
  const folio =
    (infos[0]?.Strap as string) ?? (infos[0]?.Folio as string) ?? null;
  return folio ? String(folio).replace(/-/g, "") : null;
}

async function fetchByFolio(folio: string): Promise<MiamiDadeDetails | null> {
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
  const year = Number(
    info.YearBuilt ?? building.Actual ?? building.Effective ?? 0,
  );
  const dor =
    (info.DORDescription as string) ?? (info.DORCode as string) ?? "";

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

  return {
    bedrooms: beds > 0 && beds < 30 ? beds : null,
    bathrooms: totalBaths > 0 && totalBaths < 30 ? totalBaths : null,
    sqft: sqft > 100 && sqft < 50000 ? Math.round(sqft) : null,
    lot_size: lot > 0 ? lot : null,
    year_built: year > 1800 && year < 2100 ? year : null,
    property_type: mapDorToType(String(info.DORCode ?? dor)),
    legal_description: legalDescription,
    tax_annual_amount: taxAnnualEstimate,
  };
}

export async function lookupMiamiDadeProperty(
  street: string,
  zip: string,
): Promise<MiamiDadeLookupResult> {
  try {
    if (!street?.trim() || !/^\d{5}$/.test(zip ?? "")) {
      return { found: false, error: "street and 5-digit zip required" };
    }
    const folio = await searchByAddress(street.trim(), zip);
    if (!folio) return { found: false };
    const details = await fetchByFolio(folio);
    if (!details) return { found: false, folio };
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

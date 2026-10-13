import { describe, it, expect } from "vitest";
import {
  buildMatrixInputSheet,
  matrixFormFor,
  matrixSheetToText,
  parseStreet,
  splitBaths,
  MATRIX_REMARKS_MAX,
  type MatrixInputSheet,
  type MatrixSourceProperty,
} from "@/lib/matrix-input-sheet";

const base: MatrixSourceProperty = {
  address_street: "1234 NW 5th St",
  address_city: "Miami",
  address_state: "FL",
  address_zip: "33125",
  property_type: "single_family",
  bedrooms: 3,
  bathrooms: 2.5,
  sqft: 1800,
  lot_size: 7500,
  year_built: 1998,
  list_price: 650000,
  description: "Bright home near the bay.",
  showing_instructions: "Call 24h ahead",
  occupancy_status: "owner_occupied",
  folio: "01-3105-012-0010",
  legal_description: "LOT 1 BLK 2",
  parking_spaces: 2,
  hoa_fee: null,
  tax_annual_amount: 9100,
  has_pool: true,
  cash_only: false,
  as_is_sale: true,
  flood_zone: "AE",
  appliances: ["refrigerator", "dishwasher", "ceiling_fans"],
  pricing_tier: "pro",
  mls_published_at: "2026-01-31T15:00:00Z",
  buyer_agent_commission: 2,
};

function row(sheet: MatrixInputSheet, label: string) {
  for (const s of sheet.sections) {
    const r = s.rows.find((x) => x.label === label);
    if (r) return r;
  }
  return undefined;
}

describe("matrixFormFor", () => {
  it("maps houses to RE1 and condos/townhouses to RE2", () => {
    expect(matrixFormFor("single_family")).toBe("RE1");
    expect(matrixFormFor("condo")).toBe("RE2");
    expect(matrixFormFor("townhouse")).toBe("RE2");
  });
  it("has no RE1/RE2 sheet for multi-family or unknown types", () => {
    expect(matrixFormFor("multi_family")).toBeNull();
    expect(matrixFormFor(null)).toBeNull();
    expect(buildMatrixInputSheet({ ...base, property_type: "multi_family" }, [])).toBeNull();
  });
});

describe("parseStreet", () => {
  it("splits number, compass point, name and type", () => {
    expect(parseStreet("1234 NW 5th St")).toEqual({
      number: "1234", compass: "NW", name: "5th", type: "ST", unit: null,
    });
  });
  it("extracts the unit", () => {
    expect(parseStreet("100 Brickell Ave Apt 2305")).toEqual({
      number: "100", compass: null, name: "Brickell", type: "AVE", unit: "2305",
    });
    expect(parseStreet("50 Ocean Dr #4B").unit).toBe("4B");
  });
  it("keeps what it does not recognize in the name", () => {
    expect(parseStreet("Old Cutler Road")).toEqual({
      number: null, compass: null, name: "Old Cutler Road", type: null, unit: null,
    });
  });
});

describe("splitBaths", () => {
  it("splits full and half baths", () => {
    expect(splitBaths(2.5)).toEqual({ full: 2, half: 1 });
    expect(splitBaths(3)).toEqual({ full: 3, half: 0 });
    expect(splitBaths(null)).toBeNull();
  });
});

describe("buildMatrixInputSheet", () => {
  const sheet = buildMatrixInputSheet(base, [
    { url: "https://x/2.jpg", is_primary: false },
    { url: "https://x/1.jpg", is_primary: true },
  ])!;

  it("fills the fields Lixtara knows, in Matrix format", () => {
    expect(sheet.form).toBe("RE1");
    expect(row(sheet, "Street Number")?.value).toBe("1234");
    expect(row(sheet, "List Price")?.value).toBe("$650,000");
    expect(row(sheet, "# Full Baths")?.value).toBe("2");
    expect(row(sheet, "# Half Baths")?.value).toBe("1");
    expect(row(sheet, "Pool YN")?.value).toBe("Yes");
    expect(row(sheet, "Occupancy Info.")?.value).toBe("Owner Occupied");
    expect(row(sheet, "Special Information")?.value).toBe("As Is");
    expect(row(sheet, "Equipment / Appliances")?.value).toBe("Refrigerator, Dishwasher");
    expect(row(sheet, "# Ceiling Fans")).toBeDefined();
  });

  it("leaves broker decisions empty instead of guessing", () => {
    expect(row(sheet, "Area")?.value).toBeNull();
    expect(row(sheet, "Listing Type")?.value).toBeNull();
    expect(row(sheet, "Buyer-agent compensation")?.value).toBeNull();
  });

  it("flags suggestions the broker must confirm", () => {
    expect(row(sheet, "Style")).toMatchObject({ value: "R31 POOL ONLY", verify: true });
  });

  it("computes the expiration from the list date and the tier term, clamping month ends", () => {
    expect(row(sheet, "List Date")?.value).toBe("01/31/2026");
    expect(row(sheet, "Expiration Date")?.value).toBe("01/31/2028");
    const leap = buildMatrixInputSheet({ ...base, mls_published_at: "2026-02-28T00:00:00Z" }, [])!;
    expect(row(leap, "Expiration Date")?.value).toBe("02/28/2028");
  });

  it("puts the primary photo first", () => {
    expect(sheet.photos).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
  });

  it("warns when remarks exceed the Matrix limit", () => {
    const long = buildMatrixInputSheet({ ...base, description: "a".repeat(MATRIX_REMARKS_MAX + 1) }, [])!;
    expect(row(long, "Remarks")?.hint).toMatch(/Too long/);
  });

  it("uses RE2 fields for condos", () => {
    const condo = buildMatrixInputSheet(
      { ...base, property_type: "condo", address_street: "100 Brickell Ave Apt 2305", hoa_fee: 850 },
      [],
    )!;
    expect(condo.form).toBe("RE2");
    expect(row(condo, "Unit #")?.value).toBe("2305");
    expect(row(condo, "Maintenance Fee")?.value).toBe("$850");
    expect(row(condo, "Style")?.value).toBeNull();
  });

  it("serializes to one line per field", () => {
    const text = matrixSheetToText(sheet);
    expect(text).toContain("Street Name: 5th");
    expect(text).toContain("Area: ");
    expect(text).toContain("https://x/1.jpg");
  });
});

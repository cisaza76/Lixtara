import { describe, it, expect } from "vitest";
import {
  MAX_PAGE,
  PAGE_SIZE,
  hasActiveFilters,
  isTruncated,
  ownListingMatches,
  pageCount,
  parsePropertySearch,
  propertySearchQuery,
} from "@/lib/property-search";

describe("parsePropertySearch", () => {
  it("defaults to no filters, newest first, page 1", () => {
    const s = parsePropertySearch({});
    expect(s).toEqual({
      minPrice: null, maxPrice: null, beds: null, baths: null,
      county: null, zip: null, sort: "newest", page: 1,
    });
    expect(hasActiveFilters(s)).toBe(false);
  });

  it("accepts only values from the closed lists", () => {
    const s = parsePropertySearch({
      min_price: "500000", max_price: "123", beds: "3", baths: "9",
      county: "broward", zip: "33130", sort: "price_asc", page: "2",
    });
    expect(s).toMatchObject({
      minPrice: 500_000, maxPrice: null, beds: 3, baths: null,
      county: "broward", zip: "33130", sort: "price_asc", page: 2,
    });
  });

  it("drops anything malformed or injected", () => {
    const s = parsePropertySearch({
      county: "broward'; drop table x;--", zip: "3313", sort: "random()", beds: "3.5",
    });
    expect(s).toMatchObject({ county: null, zip: null, sort: "newest", beds: null });
  });

  it("swaps an inverted price range", () => {
    const s = parsePropertySearch({ min_price: "1000000", max_price: "300000" });
    expect([s.minPrice, s.maxPrice]).toEqual([300_000, 1_000_000]);
  });

  it("clamps the page to the anti-scraping cap", () => {
    expect(parsePropertySearch({ page: "999" }).page).toBe(MAX_PAGE);
    expect(parsePropertySearch({ page: "-3" }).page).toBe(1);
    expect(parsePropertySearch({ page: ["4", "5"] }).page).toBe(4);
  });
});

describe("propertySearchQuery", () => {
  it("round-trips and omits defaults", () => {
    const s = parsePropertySearch({ beds: "2", county: "palmbeach", sort: "price_desc" });
    expect(propertySearchQuery(s)).toBe("?beds=2&county=palmbeach&sort=price_desc");
    expect(propertySearchQuery(s, { page: 3 })).toBe("?beds=2&county=palmbeach&sort=price_desc&page=3");
    expect(propertySearchQuery(parsePropertySearch({}))).toBe("");
  });
});

describe("pageCount / isTruncated", () => {
  it("caps navigable pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(50_000)).toBe(MAX_PAGE);
    expect(isTruncated(50_000)).toBe(true);
    expect(isTruncated(PAGE_SIZE * MAX_PAGE)).toBe(false);
  });
});

describe("ownListingMatches", () => {
  const home = { list_price: 600_000, bedrooms: 3, bathrooms: 2, address_zip: "33130-1234" };

  it("applies price, beds, baths and zip", () => {
    expect(ownListingMatches(home, parsePropertySearch({}))).toBe(true);
    expect(ownListingMatches(home, parsePropertySearch({ min_price: "750000" }))).toBe(false);
    expect(ownListingMatches(home, parsePropertySearch({ beds: "4" }))).toBe(false);
    expect(ownListingMatches(home, parsePropertySearch({ zip: "33130" }))).toBe(true);
    expect(ownListingMatches(home, parsePropertySearch({ zip: "33131" }))).toBe(false);
  });

  it("hides own listings under a county filter (county is not stored for them)", () => {
    expect(ownListingMatches(home, parsePropertySearch({ county: "miamidade" }))).toBe(false);
  });
});

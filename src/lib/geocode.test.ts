import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateUsAddress } from "@/lib/geocode";

const KEY = "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY";

describe("validateUsAddress", () => {
  const realFetch = global.fetch;
  const realKey = process.env[KEY];

  beforeEach(() => {
    process.env[KEY] = "test-key";
  });
  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env[KEY];
    else process.env[KEY] = realKey;
  });

  function mockGoogle(payload: unknown) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }) as unknown as typeof fetch;
  }

  it("fails open (ok:true) when the API key is missing", async () => {
    delete process.env[KEY];
    const r = await validateUsAddress("1 Main St", "Miami", "FL", "33101");
    expect(r.ok).toBe(true);
    expect(r.lat).toBeUndefined();
  });

  it("returns lat/lng from the geocode result on success", async () => {
    mockGoogle({
      status: "OK",
      results: [
        {
          geometry: {
            location_type: "ROOFTOP",
            location: { lat: 25.7617, lng: -80.1918 },
          },
          address_components: [
            { short_name: "FL", long_name: "Florida", types: ["administrative_area_level_1"] },
            { short_name: "33101", long_name: "33101", types: ["postal_code"] },
          ],
        },
      ],
    });
    const r = await validateUsAddress("1 Main St", "Miami", "FL", "33101");
    expect(r.ok).toBe(true);
    expect(r.lat).toBeCloseTo(25.7617);
    expect(r.lng).toBeCloseTo(-80.1918);
  });

  it("rejects with not_found on ZERO_RESULTS", async () => {
    mockGoogle({ status: "ZERO_RESULTS", results: [] });
    const r = await validateUsAddress("999999 Nowhere", "Miami", "FL", "33101");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("rejects when state in result doesn't match what was typed", async () => {
    mockGoogle({
      status: "OK",
      results: [
        {
          geometry: {
            location_type: "ROOFTOP",
            location: { lat: 30, lng: -85 },
          },
          address_components: [
            { short_name: "GA", long_name: "Georgia", types: ["administrative_area_level_1"] },
          ],
        },
      ],
    });
    const r = await validateUsAddress("1 Main St", "Atlanta", "FL", "30303");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("state_mismatch");
  });

  it("fails open on network error (Google's quota/key issues never block the seller)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    const r = await validateUsAddress("1 Main St", "Miami", "FL", "33101");
    expect(r.ok).toBe(true);
  });
});

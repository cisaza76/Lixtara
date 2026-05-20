import { describe, it, expect } from "vitest";
import { mapDorToType } from "@/lib/miami-dade";

describe("mapDorToType", () => {
  it("maps county DOR use codes to our property_type enum", () => {
    expect(mapDorToType("0001")).toBe("single_family");
    expect(mapDorToType("0004")).toBe("condo");
    expect(mapDorToType("0005")).toBe("condo");
    expect(mapDorToType("0081")).toBe("townhouse");
    expect(mapDorToType("0003")).toBe("multi_family");
    expect(mapDorToType("0008")).toBe("multi_family");
  });

  it("matches on the code prefix (full DOR strings carry a description suffix)", () => {
    expect(mapDorToType("0001 RESIDENTIAL - SINGLE FAMILY")).toBe("single_family");
    expect(mapDorToType("  0004 CONDOMINIUM")).toBe("condo");
  });

  it("returns null for unknown codes and empty/nullish input", () => {
    expect(mapDorToType("9999")).toBeNull();
    expect(mapDorToType("")).toBeNull();
    expect(mapDorToType(null)).toBeNull();
    expect(mapDorToType(undefined)).toBeNull();
  });
});

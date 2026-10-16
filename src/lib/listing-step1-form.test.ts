import { describe, it, expect } from "vitest";
import { decodeStep1Form, encodeStep1Form, suggestedTierParam } from "@/lib/listing-step1-form";

describe("paso 1: lo escrito sobrevive a un error", () => {
  it("ida y vuelta por la cookie", () => {
    const raw = encodeStep1Form({
      street: "100 Biscayne Blvd", unit: "4B", city: "Miami", zip: "33132", lat: "25.77", lng: "-80.18", email: "s@x.co",
    });
    expect(decodeStep1Form(raw)).toEqual({
      street: "100 Biscayne Blvd", unit: "4B", city: "Miami", zip: "33132", lat: "25.77", lng: "-80.18", email: "s@x.co",
    });
  });
  it("campos vacíos o ausentes quedan como cadena vacía; largos se recortan", () => {
    const f = decodeStep1Form(encodeStep1Form({ street: "x".repeat(500), city: "  " }))!;
    expect(f.street).toHaveLength(200);
    expect(f.city).toBe("");
    expect(f.email).toBe("");
  });
  it("valor ausente, corrupto o con tipos raros → null o vacíos, nunca lanza", () => {
    expect(decodeStep1Form(undefined)).toBeNull();
    expect(decodeStep1Form("{nope")).toBeNull();
    expect(decodeStep1Form(JSON.stringify({ street: 5, email: ["a"] }))).toEqual({
      street: "", unit: "", city: "", zip: "", lat: "", lng: "", email: "",
    });
  });
  it("suggested_tier: solo un plan válido vuelve a la URL", () => {
    const tiers = ["essentials", "pro", "concierge"];
    expect(suggestedTierParam("pro", tiers)).toBe("&suggested_tier=pro");
    expect(suggestedTierParam("gold", tiers)).toBe("");
    expect(suggestedTierParam(null, tiers)).toBe("");
  });
});

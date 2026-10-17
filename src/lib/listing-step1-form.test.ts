import { describe, it, expect } from "vitest";
import {
  STEP1_FORM_MAX_AGE_S,
  isStep1RestoreNext,
  legacyStep1FormCookiePath,
  step1FormCookiePath,
  decodeStep1Form,
  encodeStep1Form,
  step1SignInHref,
  suggestedTierParam,
} from "@/lib/listing-step1-form";

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

describe("paso 1: 'Iniciar sesión' desde el error de correo existente", () => {
  it("el regreso lleva el idioma, el plan sugerido y restore=1, codificado en next", () => {
    const href = step1SignInHref("es", "pro");
    expect(href.startsWith("/es/sign-in?next=")).toBe(true);
    const next = decodeURIComponent(href.split("next=")[1]!);
    expect(next).toBe("/es/listing/new?step=1&suggested_tier=pro&restore=1");
    // Codificado: el & de next no se confunde con un parámetro de /sign-in.
    expect(new URL(href, "https://x.test").searchParams.get("next")).toBe(next);
  });
  it("sin plan válido no inventa uno", () => {
    expect(decodeURIComponent(step1SignInHref("en", "gold"))).toContain("/en/listing/new?step=1&restore=1");
  });
  it("la cookie alcanza para iniciar sesión", () => {
    expect(STEP1_FORM_MAX_AGE_S).toBe(30 * 60);
  });
});

describe("paso 1: la cookie viaja en el POST de /sign-in", () => {
  it("path = /[lang]: cubre /[lang]/sign-in (donde se pinta el redirect) y /[lang]/listing/new", () => {
    const path = step1FormCookiePath("es");
    expect(path).toBe("/es");
    for (const req of ["/es/sign-in", "/es/listing/new"]) expect(req.startsWith(`${path}/`)).toBe(true);
    // El path anterior no cubría /sign-in: por eso el paso 1 volvía vacío.
    expect("/es/sign-in".startsWith(legacyStep1FormCookiePath("es"))).toBe(false);
  });
  it("isStep1RestoreNext: solo el regreso al paso 1 con restore=1", () => {
    expect(isStep1RestoreNext("/es/listing/new?step=1&suggested_tier=pro&restore=1")).toBe(true);
    expect(isStep1RestoreNext("/en/listing/new?restore=1")).toBe(true);
    expect(isStep1RestoreNext("/es/listing/new?step=1")).toBe(false);
    expect(isStep1RestoreNext("/es/account?restore=1")).toBe(false);
    expect(isStep1RestoreNext(undefined)).toBe(false);
  });
});

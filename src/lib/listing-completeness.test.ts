// Saltar pasos por URL (?step=7 con los pasos 2–6 vacíos): la página redirige al primer paso
// incompleto y la creación del acuerdo rechaza un listing incompleto.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_OWN_PHOTOS } from "@/lib/listing-photos";
import {
  allowedStep,
  firstIncompleteStep,
  stepComplete,
  type ListingCompletenessFacts,
} from "@/lib/listing-completeness";
import { loadFirstIncompleteStep } from "@/lib/listing-completeness.server";

const NOW = new Date("2026-10-18T12:00:00Z");

/** Borrador recién creado en el paso 1: solo la dirección, el resto en los valores iniciales. */
const fresh: ListingCompletenessFacts = {
  address_street: "123 Main St",
  address_city: "Miami",
  address_zip: "33130",
  pricing_tier: null,
  property_type: "single_family",
  bedrooms: 0,
  bathrooms: 0,
  sqft: 0,
  year_built: null,
  list_price: 0,
  description: null,
  photos_rights_confirmed: false,
  photoCount: 0,
  photographyPaid: false,
  buyerComp: null,
};

const complete: ListingCompletenessFacts = {
  ...fresh,
  pricing_tier: "essentials",
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1500,
  year_built: 1995,
  list_price: 450000,
  description: "Bright corner home near the park.",
  photos_rights_confirmed: true,
  photoCount: MIN_OWN_PHOTOS,
  buyerComp: { buyer_agent_comp_type: "percent", buyer_agent_commission: 2.5, buyer_agent_comp_amount: null },
};

describe("firstIncompleteStep", () => {
  it("borrador con solo la dirección → paso 2", () => {
    expect(firstIncompleteStep(fresh, NOW)).toBe(2);
  });

  it("sin dirección → paso 1", () => {
    expect(firstIncompleteStep({ ...fresh, address_street: "  " }, NOW)).toBe(1);
  });

  it("listing completo → null", () => {
    expect(firstIncompleteStep(complete, NOW)).toBeNull();
  });

  it("cada paso vacío se detecta en orden", () => {
    expect(firstIncompleteStep({ ...complete, pricing_tier: null }, NOW)).toBe(2);
    expect(firstIncompleteStep({ ...complete, sqft: 0 }, NOW)).toBe(3);
    expect(firstIncompleteStep({ ...complete, list_price: 0 }, NOW)).toBe(3);
    expect(firstIncompleteStep({ ...complete, year_built: null }, NOW)).toBe(3);
    expect(firstIncompleteStep({ ...complete, description: "short" }, NOW)).toBe(4);
    expect(firstIncompleteStep({ ...complete, photoCount: MIN_OWN_PHOTOS - 1 }, NOW)).toBe(5);
    expect(firstIncompleteStep({ ...complete, photos_rights_confirmed: false }, NOW)).toBe(5);
    expect(firstIncompleteStep({ ...complete, buyerComp: null }, NOW)).toBe(6);
  });

  it("estudio (0 habitaciones) es válido, como en el paso 3", () => {
    expect(stepComplete(3, { ...complete, bedrooms: 0 }, NOW)).toBe(true);
  });

  it("0% al agente del comprador es una elección válida", () => {
    expect(stepComplete(6, { ...complete, buyerComp: { buyer_agent_comp_type: "none", buyer_agent_commission: 0, buyer_agent_comp_amount: null } }, NOW)).toBe(true);
  });

  it("Pro/Concierge o fotografía pagada: sin fotos propias el paso 5 está completo", () => {
    expect(stepComplete(5, { ...complete, pricing_tier: "pro", photoCount: 0, photos_rights_confirmed: false }, NOW)).toBe(true);
    expect(stepComplete(5, { ...complete, photographyPaid: true, photoCount: 0, photos_rights_confirmed: false }, NOW)).toBe(true);
    // con fotos subidas, igual hay que confirmar los derechos
    expect(stepComplete(5, { ...complete, pricing_tier: "concierge", photoCount: 2, photos_rights_confirmed: false }, NOW)).toBe(false);
  });
});

describe("allowedStep", () => {
  it("?step=7 con el paso 2 vacío → 2", () => {
    expect(allowedStep(7, 2)).toBe(2);
  });
  it("volver a un paso anterior siempre se permite", () => {
    expect(allowedStep(1, 4)).toBe(1);
    expect(allowedStep(4, 4)).toBe(4);
  });
  it("todo completo → el paso pedido", () => {
    expect(allowedStep(8, null)).toBe(8);
  });
});

describe("loadFirstIncompleteStep (lecturas simuladas)", () => {
  function db(prop: Record<string, unknown> | null, photos: number, comp: Record<string, unknown> | null) {
    const q = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => result;
      c.then = (res: (v: unknown) => unknown) => res(result);
      return c;
    };
    return {
      from: (t: string) =>
        t === "properties"
          ? q({ data: prop, error: null })
          : t === "property_photos"
            ? q({ count: photos, error: null })
            : q({ data: [], error: null }), // payments: sin fotografía pagada
      rpc: async () => ({ data: comp ? [comp] : [], error: null }),
    } as never;
  }
  const row = {
    address_street: fresh.address_street,
    address_city: fresh.address_city,
    address_zip: fresh.address_zip,
    pricing_tier: fresh.pricing_tier,
    property_type: fresh.property_type,
    bedrooms: fresh.bedrooms,
    bathrooms: fresh.bathrooms,
    sqft: fresh.sqft,
    year_built: fresh.year_built,
    list_price: fresh.list_price,
    description: fresh.description,
    photos_rights_confirmed: fresh.photos_rights_confirmed,
  };

  it("borrador del paso 1 → 2", async () => {
    expect(await loadFirstIncompleteStep(db(row, 0, null), "p1")).toBe(2);
  });
  it("listing inexistente o ajeno (RLS) → 1", async () => {
    expect(await loadFirstIncompleteStep(db(null, 0, null), "p1")).toBe(1);
  });
});

describe("la página y la ruta usan la comprobación", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("/listing/new redirige al primer paso incompleto", () => {
    const page = src("src/app/[lang]/listing/new/page.tsx");
    expect(page).toMatch(/loadFirstIncompleteStep\(supabase, draft\.id\)/);
    expect(page).toMatch(/allowedStep\(step, firstIncomplete\)/);
    expect(page).toMatch(/redirect\(`\/\$\{lang\}\/listing\/new\?step=\$\{target\}&id=\$\{draft\.id\}`\)/);
  });
});

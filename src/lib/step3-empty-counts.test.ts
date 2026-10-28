// Habitaciones, baños y pies² nacen vacíos (regla 2026-10-27): el borrador ya no trae 1 baño que
// se mostraba como dato. El paso 3 no avanza con ellos vacíos (baños y pies² tampoco en 0;
// habitaciones admite 0 escrito = estudio, decisión del owner) y la creación del acuerdo lo
// vuelve a validar. Los borradores existentes con el 1 inicial no se tocan: el vendedor lo ve
// y lo confirma.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_OWN_PHOTOS } from "@/lib/listing-photos";
import { bedroomsFieldValue, stepComplete, type ListingCompletenessFacts } from "@/lib/listing-completeness";
import { loadFirstIncompleteStep } from "@/lib/listing-completeness.server";
import { t } from "@/lib/i18n";
import { listingErrorField } from "@/lib/analytics";

const NOW = new Date("2026-10-27T12:00:00Z");
const page = readFileSync(join(process.cwd(), "src/app/[lang]/listing/new/page.tsx"), "utf8");

const complete: ListingCompletenessFacts = {
  address_street: "10279 NW 30th Ter",
  address_city: "Doral",
  address_zip: "33172",
  pricing_tier: "essentials",
  property_type: "townhouse",
  bedrooms: 3,
  bathrooms: 2.5,
  sqft: 1854,
  year_built: 2006,
  list_price: 450000,
  financing_terms: ["cash"],
  occupancy_status: "owner_occupied",
  description: "Bright townhouse near the park.",
  photos_rights_confirmed: true,
  photoCount: MIN_OWN_PHOTOS,
  photographyPaid: false,
  buyerComp: { buyer_agent_comp_type: "percent", buyer_agent_commission: 2.5, buyer_agent_comp_amount: null },
};

describe("el borrador nace con habitaciones, baños y pies² vacíos", () => {
  it("el paso 1 crea el borrador con 0 (= vacío), sin el 1 baño de antes", () => {
    expect(page).toMatch(/bedrooms: 0,\s*bathrooms: 0,\s*sqft: 0,/);
    expect(page).not.toMatch(/bathrooms: 1,/);
  });

  it("baños y pies² en 0 se muestran en blanco", () => {
    expect(page).toMatch(/name="bathrooms"\s*type="text"\s*defaultValue=\{\s*draft\?\.bathrooms \? String\(draft\.bathrooms\) : ""\s*\}/);
    expect(page).toMatch(/name="sqft"\s*type="text"\s*defaultValue=\{draft\?\.sqft \? String\(draft\.sqft\) : ""\}/);
  });

  it("habitaciones: en blanco en un borrador nuevo; '0' en un estudio ya guardado", () => {
    expect(page).toContain("defaultValue={bedroomsFieldValue(draft)}");
    expect(bedroomsFieldValue({ bedrooms: 0, sqft: 0 })).toBe("");
    expect(bedroomsFieldValue({ bedrooms: 0, sqft: 450 })).toBe("0");
    expect(bedroomsFieldValue({ bedrooms: 3, sqft: 0 })).toBe("3");
    expect(bedroomsFieldValue(null)).toBe("");
  });

  it("un borrador existente con el 1 inicial lo sigue mostrando (no se toca la base)", () => {
    expect(page).not.toMatch(/\.update\(\{\s*bathrooms: 0\s*\}\)/);
    expect(stepComplete(3, { ...complete, bathrooms: 1 }, NOW)).toBe(true);
  });
});

describe("el paso 3 no avanza con habitaciones, baños o pies² vacíos", () => {
  it("vacío → mensaje del campo (EN/ES)", () => {
    expect(page).toContain('if (blank("bedrooms")) redirect(`/${lang}/listing/new?step=3&id=${id}&error=beds_required`);');
    expect(page).toContain('if (blank("bathrooms")) redirect(`/${lang}/listing/new?step=3&id=${id}&error=baths_required`);');
    expect(page).toContain('if (blank("sqft")) redirect(`/${lang}/listing/new?step=3&id=${id}&error=sqft_required`);');
    for (const [code, field] of [["beds_required", "bedrooms"], ["baths_required", "bathrooms"], ["sqft_required", "sqft"]] as const) {
      expect(page).toContain(`sp.error === "${code}"\n              ? copy.fieldErrors.${field}`);
      expect(listingErrorField(code)).toBe(field);
      for (const lang of ["en", "es"] as const) expect(t(lang).listingForm.fieldErrors[field], `${lang}.${field}`).toBeTruthy();
    }
    expect(t("es").listingForm.fieldErrors.bathrooms).toBe("Ingresa el número de baños.");
  });

  it("baños y pies² en 0 → invalid_baths / invalid_sqft; habitaciones en 0 es un estudio", () => {
    expect(page).toMatch(/bathrooms <= 0 \|\| bathrooms > 30\) \{\s*redirect\(`\/\$\{lang\}\/listing\/new\?step=3&id=\$\{id\}&error=invalid_baths`\)/);
    expect(page).toMatch(/sqft <= 0 \|\| sqft > 100000\) \{\s*redirect\(`\/\$\{lang\}\/listing\/new\?step=3&id=\$\{id\}&error=invalid_sqft`\)/);
    expect(page).toMatch(/bedrooms < 0 \|\| bedrooms > 30\)/);
    expect(t("es").listingForm.step3.bedroomsHelp).toBe("Estudio: escribe 0.");
    expect(t("en").listingForm.step3.bedroomsHelp).toBe("Studio: enter 0.");
  });

  it("completitud del paso 3 (la que usan la página y el acuerdo)", () => {
    expect(stepComplete(3, { ...complete, bathrooms: 0 }, NOW)).toBe(false);
    expect(stepComplete(3, { ...complete, bathrooms: null }, NOW)).toBe(false);
    expect(stepComplete(3, { ...complete, sqft: 0 }, NOW)).toBe(false);
    expect(stepComplete(3, { ...complete, bedrooms: null }, NOW)).toBe(false);
    expect(stepComplete(3, { ...complete, bedrooms: 0 }, NOW)).toBe(true);
  });
});

describe("creación del acuerdo: rechaza baños o pies² vacíos", () => {
  function db(prop: Record<string, unknown>) {
    const q = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => result;
      c.then = (res: (v: unknown) => unknown) => res(result);
      return c;
    };
    return {
      from: (table: string) =>
        table === "properties"
          ? q({ data: prop, error: null })
          : table === "property_photos"
            ? q({ count: MIN_OWN_PHOTOS, error: null })
            : q({ data: [], error: null }),
      rpc: async () => ({ data: [complete.buyerComp], error: null }),
    } as never;
  }
  const row = Object.fromEntries(
    Object.entries(complete).filter(([k]) => !["photoCount", "photographyPaid", "buyerComp"].includes(k)),
  );

  it("listing completo → null (se crea)", async () => {
    expect(await loadFirstIncompleteStep(db(row), "p1")).toBeNull();
  });
  it("baños 0 (borrador nuevo sin llenar) → paso 3 (la ruta responde 409 listing_incomplete)", async () => {
    expect(await loadFirstIncompleteStep(db({ ...row, bathrooms: 0 }), "p1")).toBe(3);
  });
  it("pies² 0 → paso 3", async () => {
    expect(await loadFirstIncompleteStep(db({ ...row, sqft: 0 }), "p1")).toBe(3);
  });
  it("la ruta del acuerdo usa esa comprobación", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/agreement/create/route.ts"), "utf8");
    expect(route).toContain("firstIncomplete = await loadFirstIncompleteStep(supabase, property.id);");
  });
});

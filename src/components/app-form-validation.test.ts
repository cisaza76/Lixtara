import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "../..");
const page = readFileSync(join(root, "src/app/[lang]/listing/new/page.tsx"), "utf8");
const component = readFileSync(join(root, "src/components/app-form-validation.tsx"), "utf8");

describe("/listing/new: validación de la app (listing_step_error sale aunque el navegador no envíe)", () => {
  it.each([
    ["saveStep1", 1],
    ["saveStep2", 2],
    ["saveStep3", 3],
    ["saveStep4", 4],
    ["nextFromStep5", 5],
  ])("el formulario de %s lleva <AppFormValidation step={%i}>", (action, step) => {
    const start = page.indexOf(`action={${action}}`);
    expect(start, action).toBeGreaterThan(-1);
    const head = page.slice(start, start + 600);
    expect(head).toContain(`<AppFormValidation step={${step}}`);
  });

  it("el componente desactiva la validación nativa, no envía si falla y reporta solo el nombre del campo", () => {
    expect(component).toContain("form.noValidate = true");
    expect(component).toContain("form.checkValidity()");
    expect(component).toContain("e.preventDefault()");
    expect(component).toMatch(/track\(\{ event: "listing_step_error", step, field, lang \}\)/);
    expect(component).not.toMatch(/\.value/); // nunca lo que la persona escribió
  });

  it("el servidor no deja pasar NaN en el paso 3 (vacío o no numérico)", () => {
    for (const v of ["bedrooms", "bathrooms", "sqft", "yearBuilt", "listPrice"]) {
      expect(page, v).toContain(`!Number.isFinite(${v}) ||`);
    }
  });
});

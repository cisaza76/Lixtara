// Paso 3: baños y pies² en 0 se rechazan también en el navegador, en el mismo intento que los
// demás errores y con el mismo mensaje por campo que el servidor (antes, baños = 0 solo lo
// rechazaba el servidor, después de completar todo lo demás; borrador is_test f29b2894).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BATHROOMS_PATTERN, SQFT_PATTERN } from "@/lib/step3-number-patterns";
import { t } from "@/lib/i18n";

/** Como lo evalúa el navegador: ^(?:patrón)$ con la bandera v (HTML, atributo pattern). */
const browser = (pattern: string) => {
  const re = new RegExp(`^(?:${pattern})$`, "v");
  return (value: string) => re.test(value);
};

// Las reglas de saveStep3 para estos dos campos.
const serverBaths = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 30;
};
const serverSqft = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n <= 100000;
};

const root = process.cwd();
const page = readFileSync(join(root, "src/app/[lang]/listing/new/page.tsx"), "utf8");
const component = readFileSync(join(root, "src/components/app-form-validation.tsx"), "utf8");
const field = readFileSync(join(root, "src/components/auth-shell.tsx"), "utf8");

describe("baños: mayor que 0 en el navegador", () => {
  const ok = browser(BATHROOMS_PATTERN);
  it.each(["1", "2", "2.5", "3.0", ".5", "0.5", "10", " 2 "])("acepta %j", (v) => {
    expect(ok(v)).toBe(true);
    expect(serverBaths(v)).toBe(true);
  });
  it.each(["0", "00", "0.0", ".0", "0."])("rechaza %j (el servidor también)", (v) => {
    expect(ok(v)).toBe(false);
    expect(serverBaths(v)).toBe(false);
  });
  it.each(["abc", "-1", "2,5", "1.2.3", "."])("rechaza lo que no es un número: %j", (v) => {
    expect(ok(v)).toBe(false);
  });
});

describe("pies²: entero mayor que 0 en el navegador", () => {
  const ok = browser(SQFT_PATTERN);
  it.each(["1854", "450", "0450", " 1200 "])("acepta %j", (v) => {
    expect(ok(v)).toBe(true);
    expect(serverSqft(v)).toBe(true);
  });
  it.each(["0", "000"])("rechaza %j (el servidor también)", (v) => {
    expect(ok(v)).toBe(false);
    expect(serverSqft(v)).toBe(false);
  });
  it.each(["1,854", "12.5", "abc", "-5"])("rechaza %j (\"1,854\" se guardaba como 1)", (v) => {
    expect(ok(v)).toBe(false);
  });
});

describe("el paso 3 usa los patrones y el mensaje del servidor", () => {
  it("baños y pies² llevan pattern; habitaciones no (acepta 0 = estudio)", () => {
    expect(page).toMatch(/name="bathrooms"[\s\S]{0,200}pattern=\{BATHROOMS_PATTERN\}\s*inputMode="decimal"/);
    expect(page).toMatch(/name="sqft"[\s\S]{0,120}pattern=\{SQFT_PATTERN\}\s*inputMode="numeric"/);
    const bedrooms = page.slice(page.indexOf('name="bedrooms"'), page.indexOf('name="bathrooms"'));
    expect(bedrooms).not.toContain("pattern=");
  });

  it("Field pasa pattern e inputMode al <input>", () => {
    expect(field).toContain("pattern={pattern}");
    expect(field).toContain("inputMode={inputMode}");
  });

  it("mismo mensaje por campo que el servidor (invalid_baths / invalid_sqft), EN y ES", () => {
    expect(page).toContain("invalidMessages={step3InvalidMessages}");
    expect(page).toMatch(/const step3InvalidMessages = \{\s*bathrooms: copy\.stepErrors\.invalidBaths,\s*sqft: copy\.stepErrors\.invalidSqft,\s*\}/);
    expect(page).toContain("? copy.stepErrors.invalidBaths");
    expect(page).toContain("? copy.stepErrors.invalidSqft");
    for (const lang of ["en", "es"] as const) {
      expect(t(lang).listingForm.stepErrors.invalidBaths).toBeTruthy();
      expect(t(lang).listingForm.stepErrors.invalidSqft).toBeTruthy();
    }
    expect(component).toMatch(/\(el\.validity\.patternMismatch && invalidMessages\[el\.name\]\)/);
  });

  it("en el mismo intento que los demás errores: todos los campos inválidos se marcan en un solo envío", () => {
    // checkValidity() de todo el formulario y un recorrido por TODOS los inválidos antes de mostrar.
    expect(component).toContain("if (form.checkValidity())");
    expect(component).toMatch(/const invalid = Array\.from\(form\.elements\)\.filter\([\s\S]*!el\.validity\.valid/);
    expect(component).toContain("for (const el of invalid)");
  });
});

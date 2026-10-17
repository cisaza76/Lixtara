import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fieldErrorId } from "@/lib/field-error-id";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Todos los campos con nombre del flujo /listing/new: la página y los componentes que
// ponen campos dentro de sus formularios.
const SOURCES = [
  "src/app/[lang]/listing/new/page.tsx",
  "src/components/address-autocomplete.tsx",
  "src/components/occupancy-section.tsx",
];
const fieldNames = (() => {
  const names = new Set<string>();
  for (const f of SOURCES) {
    for (const m of read(f).matchAll(/<(Field|input|select|textarea)\b((?:[^>"]|"[^"]*")*?)\/?>/g)) {
      const name = m[2].match(/\bname="([^"]+)"/)?.[1];
      if (name) names.add(name);
    }
  }
  return [...names];
})();

/** Un <form> como el del navegador: `form.id` devuelve el <input name="id">. */
function formWithHiddenIdInput(idAttr: string | null) {
  return {
    id: { name: "id", toString: () => "[object HTMLInputElement]" },
    getAttribute: (n: string) => (n === "id" ? idAttr : null),
  };
}

describe("aria-describedby de los mensajes por campo (AppFormValidation)", () => {
  it("el extractor encuentra los campos del flujo (no pasa en vacío)", () => {
    for (const n of ["street", "city", "state", "zip", "email", "list_price", "photos_rights_confirmed"]) {
      expect(fieldNames, n).toContain(n);
    }
    expect(fieldNames.length).toBeGreaterThan(20);
  });

  it.each(fieldNames)("%s: id válido aunque el formulario tenga <input name=\"id\">", (name) => {
    const id = fieldErrorId(formWithHiddenIdInput(null), name);
    expect(id).not.toContain("[object");
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*-error$/);
    expect(id).toBe(`listing-form-${name.replace(/[^A-Za-z0-9_-]/g, "_")}-error`);
  });

  it("si el formulario tiene atributo id, se usa ese", () => {
    expect(fieldErrorId(formWithHiddenIdInput("step3"), "state")).toBe("step3-state-error");
  });

  it("el componente nunca lee form.id", () => {
    const c = read("src/components/app-form-validation.tsx");
    expect(c).not.toMatch(/\bform\.id\b/);
    expect(c).toContain("p.id = fieldErrorId(form, key);");
    expect(c).toContain('el.setAttribute("aria-describedby", p.id);');
  });
});

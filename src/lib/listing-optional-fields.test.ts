import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { t } from "@/lib/i18n";

// Un campo rotulado "(opcional)" no puede llevar el `required` por defecto de <Field>: el
// navegador lo exigiría aunque el servidor lo acepte vacío (pasó con parqueo, HOA e impuesto).
const page = readFileSync(join(resolve(__dirname, "../.."), "src/app/[lang]/listing/new/page.tsx"), "utf8");

describe("paso 3: los campos '(opcional)' son opcionales de verdad", () => {
  const step3 = t("en").listingForm.step3 as Record<string, unknown>;
  const optionalKeys = Object.entries(step3)
    .filter(([k, v]) => k.endsWith("Label") && typeof v === "string" && /optional/i.test(v))
    .map(([k]) => k);

  it("encuentra los campos opcionales (no pasa en vacío)", () => {
    expect(optionalKeys).toEqual(expect.arrayContaining(["parkingLabel", "hoaLabel", "taxLabel", "lotSizeLabel"]));
  });

  it.each(["parkingLabel", "hoaLabel", "taxLabel", "lotSizeLabel"])("%s → <Field required={false}>", (key) => {
    const blocks = [...page.matchAll(new RegExp(`<Field\\s+label=\\{copy\\.step3\\.${key}\\}[\\s\\S]*?/>`, "g"))];
    expect(blocks.length, key).toBeGreaterThan(0);
    for (const [block] of blocks) expect(block).toContain("required={false}");
  });

  it("el rótulo dice opcional en los dos idiomas", () => {
    const es = t("es").listingForm.step3 as unknown as Record<string, string>;
    for (const key of ["parkingLabel", "hoaLabel", "taxLabel"]) expect(es[key]).toMatch(/opcional/);
  });
});

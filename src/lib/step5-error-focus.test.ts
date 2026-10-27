import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const page = read("src/app/[lang]/listing/new/page.tsx");
const banner = read("src/components/focused-error-banner.tsx");

describe("paso 5: el error del envío se ve en móvil y la casilla no se pierde", () => {
  it("el aviso lleva el scroll y el foco a sí mismo al montarse", () => {
    expect(banner).toContain('"use client"');
    expect(banner).toMatch(/scrollIntoView\(\{[^}]*block: "center"/);
    expect(banner).toContain("focus({ preventScroll: true })");
    expect(banner).toContain('role="alert"');
    expect(banner).toContain("tabIndex={-1}");
    expect(banner).toContain("prefers-reduced-motion");
    // AppFormValidation lo oculta cuando un intento nuevo falla en el navegador.
    expect(banner).toContain("data-step-notice");
  });

  it("el paso 5 lo usa y lo vuelve a montar en cada intento", () => {
    expect(page).toContain('<FocusedErrorBanner key={`${sp.error}-${sp.n ?? ""}`} message={errorMessage} />');
    expect(page).toMatch(/error=rights_required\$\{attempt\}/);
    expect(page).toMatch(/error=not_enough&rights=1\$\{attempt\}/);
  });

  it("si faltaban fotos, la casilla de derechos vuelve marcada", () => {
    expect(page).toMatch(/name="photos_rights_confirmed"[\s\S]{0,120}defaultChecked=\{sp\.rights === "1"\}/);
  });

  it("si faltaba la casilla, no se marca sola", () => {
    expect(page).not.toMatch(/error=rights_required&rights=1/);
  });
});
